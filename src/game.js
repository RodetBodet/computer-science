'use strict';
/* =====================================================================
   GAME: agents, movement physics, shooting, damage, the bomb,
   rounds and the economy.
   Match format: first to 13 (MR12), sides swap after 12 rounds,
   overtime is played in halves of 3 rounds with $10,000.
   ===================================================================== */
// ---- movement (meters / seconds) ----
const HULL_R = 0.38, H_STAND = 1.83, H_CROUCH = 1.37, EYE_STAND = 1.63, EYE_CROUCH = 1.17;
const GRAVITY = 20.32, JUMP_V = 7.6, STEP_H = 0.46;
const FRICTION = 5.2, STOP_SPEED = 80 * UNIT, ACCEL = 5.5, AIR_ACCEL = 12, AIR_CAP = 30 * UNIT;
const WALK_MULT = 0.52, DUCK_MULT = 0.34;
// ---- rules ----
const BOMB_TIME = 40, PLANT_TIME = 3.2, DEFUSE_TIME = 10, KIT_DEFUSE_TIME = 5, ROUND_END_TIME = 6;
const MAX_MONEY = 16000, OT_MONEY = 10000, OT_HALF = 3;
// game modes (set from the lobby)
// Optional per-mode keys: teamSize (players per side, default 5), sites (bombsites you may plant
// on, default all), ffa (free-for-all deathmatch: no teams, rounds, bomb or economy),
// rating (multiplier on the rating change).
const MODES = {
  competitive: { name: 'Competitive', desc: 'First to 13 rounds · sides swap after 12 · overtime on a tie · full economy', half: 12, overtime: true, startMoney: 800, freeze: 12, roundTime: 115, buyTime: 20, freeArmor: false, rating: 1 },
  casual: { name: 'Casual', desc: 'First to 8 rounds · free armor and defuse kits · more starting money', half: 7, overtime: false, startMoney: 1000, freeze: 8, roundTime: 120, buyTime: 25, freeArmor: true, rating: 0.5 },
  short: { name: 'Short Match', desc: 'First to 9 rounds · a draw is possible · full economy', half: 8, overtime: false, startMoney: 800, freeze: 10, roundTime: 115, buyTime: 20, freeArmor: false, rating: 1 },
  wingman: { name: 'Wingman', desc: '2v2 on bombsite A only · first to 9 rounds · 1:30 rounds', half: 8, overtime: false, startMoney: 800, freeze: 10, roundTime: 90, buyTime: 20, freeArmor: false, teamSize: 2, sites: ['A'], rating: 0.75 },
  deathmatch: { name: 'Deathmatch', desc: 'Free-for-all · 10 minutes or first to 40 kills · free guns, quick respawns', ffa: true, players: 10, killLimit: 40, half: 0, overtime: false, startMoney: 0, freeze: 3, roundTime: 600, buyTime: 0, freeArmor: true, rating: 0.4 },
};
// deathmatch timings (seconds)
const DM_RESPAWN = 2, DM_PROTECT = 2, DM_PICK_TIME = 6, DM_DROP_LIFE = 15;
let FREEZE_TIME = 12, ROUND_TIME = 115, BUY_TIME = 20, START_MONEY = 800, REG_HALF = 12, RULES = MODES.competitive;
function applyMode(id) {
  RULES = MODES[id] || MODES.competitive; G.mode = MODES[id] ? id : 'competitive';
  FREEZE_TIME = RULES.freeze; ROUND_TIME = RULES.roundTime; BUY_TIME = RULES.buyTime; START_MONEY = RULES.startMoney; REG_HALF = RULES.half;
}
// Every "is this an enemy?" check goes through here so free-for-all only changes one rule:
// in deathmatch everybody but yourself is hostile; in team modes the other team is.
const hostile = (a, b) => !!a && !!b && a !== b && (RULES.ffa || a.team !== b.team);
// the bombsite at this point, but only if the current mode allows planting there (Wingman: A only)
const plantSiteAt = (x, z) => { const s = siteAt(x, z); return s && (!RULES.sites || RULES.sites.includes(s)) ? s : null; };
const activeSites = () => RULES.sites || Object.keys(SITES);
const DIFFICULTY = [
  { name: 'Easy', react: 0.55, aimErr: 3.2, turn: 260, hs: 0.15, spray: 0.3, burst: 3 },
  { name: 'Normal', react: 0.34, aimErr: 1.9, turn: 420, hs: 0.35, spray: 0.6, burst: 5 },
  { name: 'Hard', react: 0.22, aimErr: 1.1, turn: 620, hs: 0.55, spray: 0.85, burst: 8 },
  { name: 'Expert', react: 0.15, aimErr: 0.6, turn: 900, hs: 0.75, spray: 0.95, burst: 12 },
];
const BOT_NAMES = { T: ['Viper', 'Rook', 'Nomad', 'Ash', 'Kestrel'], CT: ['Hawk', 'Mason', 'Echo', 'Frost', 'Bishop'] };

const G = {
  state: 'menu', paused: false, time: 0, menuT: 0,
  playerTeam: 'T', difficulty: 1, sens: 1.6, volume: 0.6, crosshairColor: '#4cff6a', quality: 1,
  phase: 'freeze', phaseT: 0, roundT: 0, round: 0, roundsPlayed: 0,
  score: { T: 0, CT: 0 }, lossCount: { T: 0, CT: 0 },
  agents: [], player: null, drops: [], killfeed: [],
  bomb: null, msg: null, tSite: 'A', intel: { A: -99, B: -99 }, roundKills: {}, lastWinner: null, mvp: null,
  buyOpen: false, boardOpen: false, specIdx: 0,
};
const D = () => DIFFICULTY[G.difficulty];
const CAM = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 73.74, shake: 0, view: null };
const fov43 = (f) => (2 * Math.atan(Math.tan((f * DEG) / 2) * 0.75)) / DEG; // horizontal FOV at 4:3 -> vertical FOV
let nextId = 1;

function makeAgent(team, name, isPlayer) {
  const a = {
    id: nextId++, team, name, isPlayer, model: null,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, duck: false, duckAmt: 0, eye: EYE_STAND, height: H_STAND, walking: false,
    alive: false, hp: 100, armor: 0, helmet: false, defuser: false, money: START_MONEY,
    kills: 0, deaths: 0, assists: 0, mvps: 0, totalDmg: 0, roundsPlayed: 0, roundDmg: 0, dmgFrom: {},
    inv: { primary: null, secondary: null, knife: 'knife', taser: null }, nades: {}, nadeSel: null, hasC4: false, slot: 'secondary', lastSlot: 'knife', ammo: {},
    weaponKey: 'knife', nextAttack: 0, reloadT: 0, reloadTotal: 0, drawT: 0, inspectT: 0, zoom: 0, rezoom: 0, recoilIdx: 0, lastShotT: -9, inacc: 0,
    punchP: 0, punchY: 0, kickP: 0, hurtP: 0, hurtY: 0, tagMod: 1, muzzleT: 0, throwT: 0, knifeT: 0, burnAcc: 0,
    skins: {}, knifeType: 'combat', knifeFinish: null,
    blindT: 0, blindMax: 0, planting: 0, defusing: false, stepAcc: 0, spottedT: -99, deathT: 0, killer: null, lastHitZone: null,
    bot: null,
  };
  for (const k of NADE_KEYS) a.nades[k] = 0;
  return a;
}
const curWeapon = (a) => WEAPONS[a.weaponKey] || WEAPONS.knife;
// what this agent's copy of a weapon looks like
const cosmeticFor = (a, key) => (key === 'knife' ? { knife: a.knifeType || 'combat', finish: a.knifeFinish, team: a.team } : { finish: a.skins[key] });
function equippedSkin(a, key) {
  if (a.isPlayer && typeof PROFILE !== 'undefined') return PROFILE.equipped.finishes[key] || null;
  return a.botSkins ? a.botSkins[key] || null : null;
}
const aliveOf = (team) => G.agents.filter((a) => a.alive && (!team || a.team === team));
const nadeCount = (a) => NADE_KEYS.reduce((s, k) => s + a.nades[k], 0);
function nextNade(a, after) {
  const start = after ? NADE_KEYS.indexOf(after) + 1 : 0;
  for (let i = 0; i < NADE_KEYS.length; i++) { const k = NADE_KEYS[(start + i) % NADE_KEYS.length]; if (a.nades[k] > 0) return k; }
  return null;
}
const slotKey = (a, slot) => slot === 'grenade' ? a.nadeSel : slot === 'c4' ? (a.hasC4 ? 'c4' : null) : a.inv[slot];

// ============================================================ PHYSICS
function hullHits(x, y, z, h) { return queryBoxes(x - HULL_R, y + 0.002, z - HULL_R, x + HULL_R, y + h, z + HULL_R); }
function moveAxis(a, axis, delta) {
  if (!delta) return false;
  if (axis === 0) a.x += delta; else if (axis === 1) a.y += delta; else a.z += delta;
  const hits = hullHits(a.x, a.y, a.z, a.height);
  if (!hits.length) return false;
  if (axis === 0) { if (delta > 0) a.x = Math.min(...hits.map((b) => b.x0)) - HULL_R - 1e-4; else a.x = Math.max(...hits.map((b) => b.x1)) + HULL_R + 1e-4; a.vx = 0; }
  else if (axis === 2) { if (delta > 0) a.z = Math.min(...hits.map((b) => b.z0)) - HULL_R - 1e-4; else a.z = Math.max(...hits.map((b) => b.z1)) + HULL_R + 1e-4; a.vz = 0; }
  else { if (delta < 0) a.y = Math.max(...hits.map((b) => b.y1)) + 1e-4; else a.y = Math.min(...hits.map((b) => b.y0)) - a.height - 1e-4; }
  return true;
}
function moveHorizontal(a, axis, delta) {
  const ox = a.x, oy = a.y, oz = a.z, ov = axis === 0 ? a.vx : a.vz;
  if (!moveAxis(a, axis, delta)) return;
  if (!a.onGround) return;
  // blocked: try stepping up onto a stair / small ledge
  const bx = a.x, bz = a.z, bv = axis === 0 ? a.vx : a.vz;
  a.x = ox; a.z = oz; a.y = oy + STEP_H;
  if (hullHits(a.x, a.y, a.z, a.height).length) { a.y = oy; a.x = bx; a.z = bz; return; }
  if (axis === 0) a.vx = ov; else a.vz = ov;
  if (moveAxis(a, axis, delta)) { a.x = bx; a.z = bz; a.y = oy; if (axis === 0) a.vx = bv; else a.vz = bv; return; }
  // settle back down onto the step
  moveAxis(a, 1, -STEP_H - 0.01);
  if (a.y < oy) { a.x = bx; a.z = bz; a.y = oy; if (axis === 0) a.vx = bv; else a.vz = bv; }
}
function maxSpeed(a) {
  const w = curWeapon(a);
  let s = w.speed * UNIT;
  if (w.scope && a.zoom && w.cat === 'sniper') s = (w.key === 'awp' ? 100 : 230) * UNIT; else if (w.scope && a.zoom) s *= 0.75;
  return s * a.tagMod;
}
// Source-style ground/air movement. wishX/wishZ = unit direction (or 0)
function physicsStep(a, wishX, wishZ, wantJump, dt) {
  // ducking
  const wasH = a.height;
  const targetDuck = a.duck ? 1 : 0;
  let nd = a.duckAmt + clamp(targetDuck - a.duckAmt, -dt / 0.18, dt / 0.12);
  const nh = lerp(H_STAND, H_CROUCH, nd);
  if (nh > wasH) { // standing up needs headroom
    const room = !hullHits(a.x, a.y, a.z, nh).length;
    if (!room) { if (!a.onGround && !hullHits(a.x, a.y - (nh - wasH), a.z, nh).length) a.y -= nh - wasH; else { nd = a.duckAmt; } }
  }
  a.duckAmt = nd; a.height = lerp(H_STAND, H_CROUCH, nd); a.eye = lerp(EYE_STAND, EYE_CROUCH, nd);
  if (!a.onGround && a.height < wasH && !hullHits(a.x, a.y + (wasH - a.height), a.z, a.height).length) a.y += wasH - a.height; // tuck legs mid-air
  const speedCap = maxSpeed(a) * (a.duck && a.onGround ? DUCK_MULT : a.walking ? WALK_MULT : 1);
  if (a.onGround) {
    // friction
    const sp = Math.hypot(a.vx, a.vz);
    if (sp > 0.001) {
      const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt, ns = Math.max(0, sp - drop) / sp;
      a.vx *= ns; a.vz *= ns;
    }
    // accelerate
    if (wishX || wishZ) {
      const cur = a.vx * wishX + a.vz * wishZ, add = speedCap - cur;
      if (add > 0) { const acc = Math.min(ACCEL * dt * speedCap, add); a.vx += wishX * acc; a.vz += wishZ * acc; }
    }
    if (wantJump) { a.vy = JUMP_V; a.onGround = false; a.jumpT = G.time; if (a.isPlayer || dist3(a, SFX.listener) < 15) SFX.play('step', a.isPlayer ? null : { x: a.x, y: a.y, z: a.z }); }
  } else if (wishX || wishZ) {
    // air acceleration with the classic 30-unit cap (allows air strafing)
    const cur = a.vx * wishX + a.vz * wishZ, add = Math.min(speedCap, AIR_CAP) - cur;
    if (add > 0) { const acc = Math.min(AIR_ACCEL * dt * speedCap, add); a.vx += wishX * acc; a.vz += wishZ * acc; }
  }
  if (!a.onGround) a.vy -= GRAVITY * dt;
  const wasGround = a.onGround;
  const fallV = a.vy;
  moveHorizontal(a, 0, a.vx * dt);
  moveHorizontal(a, 2, a.vz * dt);
  const hitY = moveAxis(a, 1, a.vy * dt);
  if (hitY) { if (a.vy < 0) { a.onGround = true; if (!wasGround && fallV < -4) onLand(a, fallV); } a.vy = 0; }
  else if (a.onGround || a.vy <= 0) {
    // stay glued to the ground when walking down stairs
    if (wasGround && a.vy <= 0) {
      const oy = a.y;
      if (moveAxis(a, 1, -STEP_H - 0.02)) { a.onGround = true; a.vy = 0; } else { a.y = oy; a.onGround = false; }
    } else a.onGround = false;
  }
  if (a.y < -6) { a.y = 0; a.x = clamp(a.x, 2, MAP_W - 2); }
  if (a.tagMod < 1) a.tagMod = Math.min(1, a.tagMod + dt * 1.4);
}
function onLand(a, v) {
  if (a.isPlayer) { a.kickP -= clamp(-v * 0.15, 0, 1.5); }
  if (a.isPlayer || dist3(a, SFX.listener) < 20) SFX.play('land', a.isPlayer ? null : { x: a.x, y: a.y, z: a.z });
  if (v < -4) makeSound(a, a.x, a.z, 16, 'step');
}
function surfaceUnder(a) {
  const hits = queryBoxes(a.x - 0.1, a.y - 0.1, a.z - 0.1, a.x + 0.1, a.y + 0.01, a.z + 0.1);
  let best = null; for (const b of hits) if (!best || b.y1 > best.y1) best = b;
  return best ? best.surface : 'concrete';
}
function footsteps(a, dt) {
  const sp = Math.hypot(a.vx, a.vz);
  if (!a.onGround || sp < 0.5) return;
  a.stepAcc += sp * dt;
  if (a.stepAcc < 1.55) return;
  a.stepAcc = 0;
  const loud = sp > maxSpeed(a) * 0.56 && !a.duck; // walking and crouching are silent
  if (!loud) return;
  makeSound(a, a.x, a.z, 24, 'step');
  if (a.isPlayer) SFX.play('step', null, surfaceUnder(a));
  else if (dist3(a, SFX.listener) < 28) SFX.play('step', { x: a.x, y: a.y, z: a.z }, surfaceUnder(a));
}
// keep agents from overlapping
function separateAgents() {
  const list = aliveOf();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (Math.abs(a.y - b.y) > 1.6) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = HULL_R * 1.9;
    if (d > 0 && d < min) {
      const push = (min - d) * 0.5, nx = (dx / d) * push, nz = (dz / d) * push;
      if (!hullHits(a.x - nx, a.y, a.z - nz, a.height).length) { a.x -= nx; a.z -= nz; }
      if (!hullHits(b.x + nx, b.y, b.z + nz, b.height).length) { b.x += nx; b.z += nz; }
    }
  }
}

// ============================================================ WEAPONS
function giveWeapon(a, key, ammo) {
  const w = WEAPONS[key];
  if (w.slot === 'grenade') { a.nades[key]++; if (!a.nadeSel) a.nadeSel = key; return; }
  if (w.slot === 'c4') { a.hasC4 = true; return; }
  a.inv[w.slot] = key;
  if (w.mag) a.ammo[key] = ammo ? { mag: ammo.mag, res: ammo.res } : { mag: w.mag, res: w.reserve };
}
function equip(a, slot, force) {
  const key = slotKey(a, slot);
  if (!key || (a.slot === slot && a.weaponKey === key && !force)) return false;
  if (a.slot !== slot) a.lastSlot = a.slot;
  a.slot = slot; a.weaponKey = key;
  const w = WEAPONS[key];
  a.drawT = w.deploy; a.reloadT = 0; a.zoom = 0; a.rezoom = 0; a.inspectT = 0; a.recoilIdx = 0; a.planting = 0;
  a.nextAttack = Math.max(a.nextAttack, G.time + w.deploy * 0.9);
  if (a.isPlayer) SFX.play('deploy');
  return true;
}
function bestSlot(a) { return a.inv.primary ? 'primary' : a.inv.secondary ? 'secondary' : 'knife'; }
function cycleGrenade(a) {
  if (a.slot !== 'grenade') return equip(a, 'grenade');
  const n = nextNade(a, a.nadeSel);
  if (n && n !== a.nadeSel) { a.nadeSel = n; equip(a, 'grenade', true); }
}
function startReload(a) {
  const w = curWeapon(a), am = a.ammo[a.weaponKey];
  if (!w.mag || !am || a.reloadT > 0 || am.mag >= w.mag || am.res <= 0 || a.drawT > 0) return false;
  a.zoom = 0; a.rezoom = 0; a.inspectT = 0;
  if (w.cat === 'heavy' && w.key !== 'mag7') { a.reloadT = 0.55; a.reloadTotal = 0.55; a.shellReload = true; } // shotguns load shell by shell
  else { a.reloadT = w.reload; a.reloadTotal = w.reload; a.shellReload = false; }
  const rpos = a.isPlayer || a === CAM.view ? null : { x: a.x, y: a.y + 1, z: a.z };
  a.sampledReload = (a.isPlayer || dist3(a, SFX.listener) < 16) && SFX.reload(w, rpos);
  if (!a.sampledReload && (a.isPlayer || dist3(a, SFX.listener) < 14)) SFX.play('clipout', rpos);
  if (!a.isPlayer) makeSound(a, a.x, a.z, 10, 'reload');
  return true;
}
function updateWeapon(a, dt) {
  const w = curWeapon(a);
  a.drawT = Math.max(0, a.drawT - dt); a.muzzleT -= dt; a.throwT -= dt; a.knifeT -= dt; a.inspectT = Math.max(0, a.inspectT - dt);
  if (a.blindT > 0) a.blindT -= dt;
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) {
      const am = a.ammo[a.weaponKey];
      if (am) {
        if (a.shellReload) {
          am.mag++; am.res--;
          if (a.isPlayer && !SFX.sample('shell_in', null, 0.3)) SFX.play('clipin');
          if (am.mag < w.mag && am.res > 0) { a.reloadT = 0.5; a.reloadTotal = 0.5; } else { a.reloadT = 0; if (a.isPlayer) SFX.play('pump'); }
        } else {
          const take = Math.min(w.mag - am.mag, am.res); am.mag += take; am.res -= take; a.reloadT = 0;
          if (a.isPlayer && !a.sampledReload) SFX.play('clipin');
        }
      }
    }
  }
  // inaccuracy + spray recovery
  if (w.inFire) a.inacc = Math.max(0, a.inacc - dt * (w.inFire * 7) / w.recover);
  const cyc = w.rpm ? 60 / w.rpm : 0.2;
  if (G.time - a.lastShotT > cyc * 1.15 + 0.03) a.recoilIdx = Math.max(0, a.recoilIdx - dt * (w.cat === 'pistol' ? 9 : 15));
  const pat = w.pattern;
  if (pat) {
    const i = Math.min(pat.length - 1, a.recoilIdx), i0 = Math.floor(i), f = i - i0, p0 = pat[i0], p1 = pat[Math.min(pat.length - 1, i0 + 1)];
    const ty = lerp(p0[0], p1[0], f) * 0.45, tp = lerp(p0[1], p1[1], f) * 0.45;
    a.punchY = lerp(a.punchY, ty, Math.min(1, dt * 22)); a.punchP = lerp(a.punchP, tp, Math.min(1, dt * 22));
  }
  a.kickP *= Math.exp(-dt * 9); a.hurtP *= Math.exp(-dt * 10); a.hurtY *= Math.exp(-dt * 10);
  if (a.rezoom && G.time >= a.nextAttack - 0.05 && a.reloadT <= 0) { a.zoom = a.rezoom; a.rezoom = 0; }
}
// current cone (radians)
function inaccuracy(a, w) {
  if (!w.inStand && w.inStand !== 0) return 0;
  let base = w.cat === 'sniper' && a.zoom ? w.inScoped : w.inStand;
  if (a.duckAmt > 0.9 && a.onGround) base *= w.inCrouch;
  const sp = Math.hypot(a.vx, a.vz), ms = w.speed * UNIT;
  const mf = clamp((sp / ms - 0.34) / 0.66, 0, 1);
  let inacc = base + mf * w.inMove + a.inacc;
  if (!a.onGround) inacc += w.inJump * (w.key === 'ssg08' && Math.abs(a.vy) < 1.2 ? 0.05 : 1); // jump-scouting at the apex is accurate
  return inacc;
}
function canAttack(a) {
  if (!a.alive || G.phase === 'freeze' || a.drawT > 0 || G.time < a.nextAttack || a.planting || a.defusing) return false;
  if (a.isPlayer && G.buyOpen) return false;
  return true;
}
const _dir = { x: 0, y: 0, z: 0 };
function eyePos(a) { return { x: a.x, y: a.y + a.eye, z: a.z }; }
// fire the current weapon along the agent's view (+ optional bot aim error)
function fireWeapon(a, errYaw = 0, errPitch = 0) {
  const w = curWeapon(a), key = a.weaponKey;
  if (w.cat === 'knife') { knifeAttack(a, false); return true; }
  if (w.cat === 'grenade' || w.cat === 'c4') return false;
  if (a.reloadT > 0) { if (a.shellReload && a.ammo[key].mag > 0) a.reloadT = 0; else return false; }
  const am = a.ammo[key];
  if (!am || am.mag <= 0) { if (a.isPlayer) SFX.play('empty'); a.nextAttack = G.time + 0.25; startReload(a); return false; }
  am.mag--;
  a.protectT = 0; // shooting ends deathmatch spawn protection, so it can't be abused
  a.nextAttack = G.time + 60 / w.rpm; a.lastShotT = G.time; a.muzzleT = 0.05; a.inspectT = 0;
  const e = eyePos(a);
  const spread = inaccuracy(a, w);
  const pat = w.pattern ? w.pattern[Math.min(w.pattern.length - 1, Math.floor(a.recoilIdx))] : [0, 0];
  const comp = a.bot ? a.bot.recoilComp : 0; // bots pull down against the pattern
  const baseYaw = a.yaw - (pat[0] * (1 - comp)) * DEG + errYaw, basePitch = a.pitch + (pat[1] * (1 - comp)) * DEG + errPitch;
  let killed = false;
  for (let p = 0; p < w.pellets; p++) {
    const r = spread * Math.sqrt(Math.random()), th = Math.random() * TAU;
    let yy = baseYaw + Math.cos(th) * r, pp = basePitch + Math.sin(th) * r;
    if (w.spread) { const r2 = w.spread * Math.sqrt(Math.random()), t2 = Math.random() * TAU; yy += Math.cos(t2) * r2; pp += Math.sin(t2) * r2 * 0.7; }
    dirFromAngles(yy, pp, _dir);
    killed = traceBullet(a, e.x, e.y, e.z, _dir.x, _dir.y, _dir.z, w, key, p === 0) || killed;
  }
  a.inacc = Math.min(a.inacc + w.inFire, 0.12);
  a.recoilIdx += 1;
  if (w.kick) a.kickP += w.kick;
  else if (w.cat === 'heavy') a.kickP += 1.6;
  // sound + noise
  if (a.isPlayer) SFX.shot(w.sound, null);
  else SFX.shot(w.sound, { x: a.x, y: a.y + 1.5, z: a.z });
  makeSound(a, a.x, a.z, w.silenced ? 12 : 70, 'shot');
  if (a.isPlayer || a === CAM.view) FX.flashLight(e.x + Math.sin(-a.yaw) * 0.6, e.y - 0.2, e.z - Math.cos(a.yaw) * 0.6, 0xffc070, w.silenced ? 0 : 3.5, 0.06, 8);
  if (w.cat === 'sniper' && a.zoom) { a.rezoom = a.zoom; a.zoom = 0; }
  if (w.cat === 'sniper' && a.isPlayer) setTimeout(() => SFX.play('bolt'), 350);
  if (a.isPlayer && (w.key === 'nova' || w.key === 'sawedoff')) setTimeout(() => SFX.play('pump'), 300);
  if (am.mag === 0 && am.res > 0) setTimeout(() => { if (a.alive && a.weaponKey === key && a.ammo[key] && a.ammo[key].mag === 0) startReload(a); }, 300);
  if (key === 'taser') { a.inv.taser = null; delete a.ammo.taser; setTimeout(() => { if (a.alive && a.slot === 'taser') equip(a, bestSlot(a)); }, 500); }
  return true;
}
// hitscan with wall penetration
function traceBullet(a, ox, oy, oz, dx, dy, dz, w, key, withTracer) {
  const maxT = w.range * UNIT;
  const world = rayCast(ox, oy, oz, dx, dy, dz, maxT, true);
  const events = world.map((h) => ({ t: h.tIn, h }));
  for (const v of G.agents) {
    if (!v.alive || v === a) continue;
    const r = rayAgent(v, ox, oy, oz, dx, dy, dz, maxT);
    if (r) events.push({ t: r.t, v, zone: r.zone });
  }
  events.sort((p, q) => p.t - q.t);
  let dmg = w.dmg, power = w.pen, wallbang = false, endT = maxT, killed = false, hitV = null;
  const thruSmoke = smokeBlocks(ox, oy, oz, ox + dx * Math.min(maxT, 60), oy + dy * Math.min(maxT, 60), oz + dz * Math.min(maxT, 60));
  let lastExit = 0;
  for (const ev of events) {
    if (ev.v) {
      if (!hostile(a, ev.v)) continue; // no friendly fire from bullets (everyone is hostile in deathmatch)
      if (key === 'taser' && ev.t > 3.6) { endT = ev.t; break; }
      const dist = ev.t / UNIT;
      const d = dmg * Math.pow(w.rangeMod, dist / 500);
      const hx = ox + dx * ev.t, hy = oy + dy * ev.t, hz = oz + dz * ev.t;
      FX.bloodHit(hx, hy, hz, dx, dy, dz, ev.zone === 'head');
      const wasAlive = ev.v.alive;
      applyDamage(ev.v, a, key, d, ev.zone, { x: dx, y: dy, z: dz, wallbang, smoke: thruSmoke });
      if (wasAlive && !ev.v.alive) killed = true;
      endT = ev.t; hitV = ev.v;
      break;
    }
    const h = ev.h, b = h.b;
    if (h.tIn < lastExit - 0.001) continue; // inside a merged/overlapping box we already passed
    const px = ox + dx * h.tIn, py = oy + dy * h.tIn, pz = oz + dz * h.tIn;
    const n = [0, 0, 0]; n[h.ax < 0 ? 1 : h.ax] = -Math.sign([dx, dy, dz][h.ax < 0 ? 1 : h.ax]) || 1;
    FX.impact(px, py, pz, n, b.surface);
    if (dist3({ x: px, y: py, z: pz }, SFX.listener) < 18 && Math.random() < 0.5) SFX.play('impact', { x: px, y: py, z: pz }, b.surface);
    const hollow = b.mat && (b.mat.startsWith('container') || b.mat === 'vehicle' || b.mat === 'dumpster' || b.mat === 'metal');
    const thick = hollow ? 0.12 : Math.min(h.tOut, maxT) - h.tIn;
    const cost = b.pen > 0 && power > 0 ? thick / (b.pen * 0.28 * power) : 99;
    if (cost >= 1) { endT = h.tIn; break; }
    dmg *= 1 - cost * 0.7; power -= cost * 0.8; wallbang = true; lastExit = h.tOut;
    const ex = ox + dx * h.tOut, ey = oy + dy * h.tOut, ez = oz + dz * h.tOut;
    FX.impact(ex, ey, ez, [-n[0], -n[1], -n[2]], b.surface);
  }
  punchSmoke(ox, oy, oz, dx, dy, dz, Math.min(endT, 80));
  // tracer from the muzzle
  if (withTracer && Math.random() < (a.isPlayer ? 0.35 : 0.6)) {
    const m = muzzleWorld(a);
    FX.tracer(m.x, m.y, m.z, ox + dx * Math.min(endT, 150), oy + dy * Math.min(endT, 150), oz + dz * Math.min(endT, 150));
  }
  // bullets cracking past your head
  const view = CAM.view;
  if (view && view.alive && hostile(a, view) && hitV !== view) {
    const tx = view.x - ox, ty = view.y + view.eye - oy, tz = view.z - oz, t = tx * dx + ty * dy + tz * dz;
    if (t > 0 && t < endT && Math.hypot(tx - dx * t, ty - dy * t, tz - dz * t) < 1.4) SFX.play('whizz', { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t });
  }
  return killed;
}
function muzzleWorld(a) {
  const f = dirFromAngles(a.yaw, a.pitch), rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
  return { x: a.x + f.x * 0.7 + rx * 0.12, y: a.y + a.eye - 0.18 + f.y * 0.7, z: a.z + f.z * 0.7 + rz * 0.12 };
}
function knifeAttack(a, heavy) {
  a.nextAttack = G.time + (heavy ? 1.1 : 0.48); a.knifeT = heavy ? 0.6 : 0.4; a.protectT = 0;
  SFX.play('knife', a.isPlayer ? null : { x: a.x, y: a.y + 1, z: a.z });
  const e = eyePos(a); dirFromAngles(a.yaw, a.pitch, _dir);
  let best = null;
  for (const v of G.agents) {
    if (!v.alive || !hostile(a, v)) continue;
    const r = rayAgent(v, e.x, e.y, e.z, _dir.x, _dir.y, _dir.z, heavy ? 1.6 : 1.9);
    if (r && (!best || r.t < best.t)) best = { v, t: r.t, zone: r.zone };
  }
  if (!best) { const h = rayCast(e.x, e.y, e.z, _dir.x, _dir.y, _dir.z, 1.6, false); if (h) { FX.impact(e.x + _dir.x * h.t, e.y + _dir.y * h.t, e.z + _dir.z * h.t, h.n, h.b.surface); SFX.play('impact', { x: e.x, y: e.y, z: e.z }, h.b.surface); } return; }
  const v = best.v;
  const fwd = dirFromAngles(v.yaw, 0), back = (fwd.x * (v.x - a.x) + fwd.z * (v.z - a.z)) / (Math.hypot(v.x - a.x, v.z - a.z) || 1) > 0.5;
  const dmg = heavy ? (back ? 180 : 65) : (back ? 90 : 40);
  SFX.play('knifehit', { x: v.x, y: v.y + 1, z: v.z });
  FX.bloodHit(v.x, v.y + 1.2, v.z, _dir.x, _dir.y, _dir.z, false);
  applyDamage(v, a, 'knife', dmg, 'chest', { x: _dir.x, y: _dir.y, z: _dir.z, knife: true });
}
// grenade throw: left = full, right = underhand, both = medium
function throwNade(a, power) {
  const key = a.nadeSel;
  if (!key || a.nades[key] <= 0) return;
  const e = eyePos(a);
  const pitch = a.pitch + (10 * DEG) * (1 - Math.abs(a.pitch) / (Math.PI / 2)); // throws aim a little above the crosshair
  const d = dirFromAngles(a.yaw, clamp(pitch, -1.5, 1.5));
  const speed = 15.2 * (power === 1 ? 1 : power === 0.5 ? 0.62 : 0.32);
  throwGrenade(a, key, e.x + d.x * 0.3, e.y - 0.05 + d.y * 0.3, e.z + d.z * 0.3, d.x * speed + a.vx * 1.1, d.y * speed + a.vy * 0.8, d.z * speed + a.vz * 1.1);
  a.nades[key]--; a.throwT = 0.4; a.nextAttack = G.time + 0.9;
  SFX.play('throw', a.isPlayer ? null : { x: a.x, y: a.y + 1.5, z: a.z });
  const after = a.nades[key] > 0 ? key : nextNade(a);
  setTimeout(() => {
    if (!a.alive) return;
    if (after) { a.nadeSel = after; if (a.slot === 'grenade') equip(a, 'grenade', true); }
    else { a.nadeSel = null; equip(a, bestSlot(a)); }
  }, 450);
}

// ============================================================ DAMAGE
function applyDamage(v, att, key, dmg, zone, info = {}) {
  if (!v.alive) return;
  // deathmatch: fresh spawns are invulnerable for a moment, and once the match is decided
  // nobody can take damage so the final leaderboard stays as announced
  if (RULES.ffa && (v.protectT > G.time || G.phase === 'over')) return;
  const w = WEAPONS[key] || {};
  let d = dmg * (info.fire || info.blast || info.knife ? 1 : ZONE_MULT[zone] || 1);
  let armorHit = false;
  const armored = v.armor > 0 && !info.fire && key !== 'taser' && zone !== 'leg' && (zone !== 'head' || v.helmet);
  if (armored) {
    const ratio = info.blast ? 0.5 : w.ap || 0.5;
    let toHealth = d * ratio, toArmor = (d - toHealth) * 0.5;
    if (toArmor > v.armor) { toHealth = d - v.armor * 2; toArmor = v.armor; }
    v.armor = Math.max(0, Math.round(v.armor - toArmor)); d = toHealth; armorHit = true;
    if (v.armor <= 0) v.helmet = false;
  }
  d = Math.max(1, Math.round(d));
  const real = Math.min(d, v.hp);
  v.hp -= d;
  v.tagMod = Math.min(v.tagMod, info.fire ? 0.8 : zone === 'leg' ? 0.6 : 0.45);
  if (att && att !== v) {
    const foe = hostile(att, v);
    att.roundDmg += foe ? real : 0; att.totalDmg += foe ? real : 0;
    v.dmgFrom[att.id] = (v.dmgFrom[att.id] || 0) + real;
  }
  v.lastHitZone = zone;
  // view punch for the victim (much stronger without armor)
  if (!info.fire) { const k = armorHit ? 0.6 : 2.2; v.hurtP += rand(0.6, 1.2) * k; v.hurtY += rand(-1, 1) * k; }
  if (v.isPlayer) onPlayerHurt(att, d, info);
  else if (v.bot) botOnHurt(v, att);
  if (att && (att.isPlayer || att === CAM.view)) SFX.play(zone === 'head' && !info.fire ? (v.helmet || armorHit && zone === 'head' ? 'helmet' : 'headshot') : 'hit');
  else if (zone === 'head' && dist3(v, SFX.listener) < 20) SFX.play('headshot', { x: v.x, y: v.y + 1.7, z: v.z });
  if (v.hp <= 0) killAgent(v, att, key, zone === 'head' && !info.fire && !info.blast, info);
}
function killAgent(v, k, key, hs, info) {
  v.hp = 0; v.alive = false; v.deaths++; v.deathT = G.time; v.killer = k; v.planting = 0; v.defusing = false; v.reloadT = 0; v.zoom = 0;
  if (v.model) {
    const f = dirFromAngles(v.yaw, 0), along = info && info.x !== undefined ? f.x * info.x + f.z * info.z : -1;
    v.model.deathDir = along < 0 ? 1 : -1; // shot from the front: fall backward
    v.model.deathSide = rand(-1, 1); v.model.deathT = 0;
  }
  if (G.bomb.defuser === v) { G.bomb.defuser = null; }
  if (RULES.ffa) v.respawnAt = G.time + DM_RESPAWN;
  if (v.hasC4) dropC4(v);
  dropWeapon(v, v.inv.primary ? 'primary' : 'secondary', false);
  if (k && k !== v) {
    if (hostile(k, v) && k.isPlayer) trackEvent('kill', { hs, cat: WEAPONS[key] ? WEAPONS[key].cat : 'any' });
    if (hostile(k, v)) {
      k.kills++; G.roundKills[k.id] = (G.roundKills[k.id] || 0) + 1;
      if (!RULES.ffa) addMoney(k, (WEAPONS[key] && WEAPONS[key].award) || 300); // no economy in deathmatch
    } else { k.kills--; addMoney(k, -300); }
  }
  // assists: 41+ damage from someone other than the killer
  for (const id in v.dmgFrom) { const o = G.agents.find((x) => x.id == id); if (o && o !== k && hostile(o, v) && v.dmgFrom[id] >= 41) o.assists++; }
  addKillfeed(k, v, key, hs, info || {}, k && k.blindT > 0.5, k && WEAPONS[key] && WEAPONS[key].cat === 'sniper' && !k.zoom);
  SFX.play('death', { x: v.x, y: v.y + 1, z: v.z });
  if (!RULES.ffa) for (const b of G.agents) if (b.bot && b.alive && b.team === v.team) botTeammateDied(b, v, k); // no teammates in FFA
  if (v.isPlayer) onPlayerDeath();
}
function addMoney(a, amt) {
  const before = a.money;
  a.money = clamp(a.money + amt, 0, MAX_MONEY);
  if (a.isPlayer && a.money !== before) popMoney(a.money - before);
}
// ---------- dropped weapons ----------
function dropWeapon(a, slot, toss) {
  const key = a.inv[slot];
  if (!key || slot === 'knife') return false;
  const am = a.ammo[key] || { mag: 0, res: 0 };
  const d = dirFromAngles(a.yaw, 0);
  const sp = toss ? 4.5 : rand(0, 1);
  const drop = { key, x: a.x, y: a.y + (toss ? a.eye - 0.3 : 0.8), z: a.z, vx: d.x * sp + a.vx * 0.5, vy: toss ? 2 : 0, vz: d.z * sp + a.vz * 0.5, mag: am.mag, res: am.res, t: G.time, owner: a, rest: false };
  drop.skin = a.skins[key] || null;
  drop.mesh = gunModel(key, { finish: drop.skin }).group; drop.mesh.rotation.set(0, rand(0, TAU), Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1));
  FX.scene.add(drop.mesh);
  G.drops.push(drop);
  a.inv[slot] = null; delete a.ammo[key];
  if (a.slot === slot) { a.reloadT = 0; a.zoom = 0; if (a.alive) equip(a, bestSlot(a)); }
  return true;
}
function dropC4(a) {
  const b = G.bomb;
  a.hasC4 = false;
  b.state = 'dropped'; b.carrier = null; b.x = a.x; b.y = a.y; b.z = a.z; b.vy = 1;
  b.dropT = G.time; b.dropper = a;
  if (a.slot === 'c4' && a.alive) equip(a, bestSlot(a));
}
function updateDrops(dt) {
  for (let i = G.drops.length - 1; i >= 0; i--) {
    const d = G.drops[i];
    if (!d.rest) {
      d.vy -= GRAVITY * 0.6 * dt;
      const nx = d.x + d.vx * dt; if (!pointSolid(nx, d.y + 0.05, d.z)) d.x = nx; else d.vx *= -0.3;
      const nz = d.z + d.vz * dt; if (!pointSolid(d.x, d.y + 0.05, nz)) d.z = nz; else d.vz *= -0.3;
      const ny = d.y + d.vy * dt;
      if (pointSolid(d.x, ny, d.z) || ny < 0) { d.vy = 0; d.vx *= 0.5; d.vz *= 0.5; if (Math.hypot(d.vx, d.vz) < 0.2) d.rest = true; } else d.y = ny;
    }
    d.mesh.position.set(d.x, d.y + 0.03, d.z);
  }
  // walking over a gun takes it if that slot is empty
  for (const a of G.agents) {
    if (!a.alive) continue;
    for (let i = G.drops.length - 1; i >= 0; i--) {
      const d = G.drops[i], w = WEAPONS[d.key];
      if (a.inv[w.slot] || G.time - d.t < (d.owner === a ? 1.5 : 0.3)) continue;
      if (Math.hypot(a.x - d.x, a.z - d.z) > 0.7 || Math.abs(a.y - d.y) > 1.2) continue;
      pickupDrop(a, i);
    }
  }
  // bomb pickup
  const b = G.bomb;
  if (b.state === 'dropped') {
    if (b.vy) { b.y = Math.max(0, b.y - dt * 4); const hit = queryBoxes(b.x - 0.1, b.y - 0.05, b.z - 0.1, b.x + 0.1, b.y + 0.02, b.z + 0.1); if (hit.length) { b.y = Math.max(...hit.map((h) => h.y1)); b.vy = 0; } }
    for (const a of G.agents) {
      if (!a.alive || a.team !== 'T' || (a === b.dropper && G.time - b.dropT < 1.5)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < 0.8 && Math.abs(a.y - b.y) < 1.2) {
        a.hasC4 = true; b.state = 'carried'; b.carrier = a;
        if (a.isPlayer) { SFX.play('pickup'); showMsg('', 'You picked up the C4', 1.6); }
        if (a.bot) botGotBomb(a);
        break;
      }
    }
  }
}
function pickupDrop(a, i) {
  const d = G.drops[i], w = WEAPONS[d.key];
  giveWeapon(a, d.key, { mag: d.mag, res: d.res });
  a.skins[d.key] = d.skin || null; // a picked-up gun keeps its finish
  FX.scene.remove(d.mesh); G.drops.splice(i, 1);
  if (a.isPlayer) { SFX.play('pickup'); showMsg('', `Picked up ${w.name}`, 1.2); }
  if (w.slot === 'primary' && (a.bot || a.slot !== 'primary')) { if (a.bot || a.slot === 'knife') equip(a, 'primary'); }
}
// E: swap for the gun you're looking at
function tryUseWeapon(a) {
  const e = eyePos(a); dirFromAngles(a.yaw, a.pitch, _dir);
  let best = -1, bd = 2.2;
  G.drops.forEach((d, i) => {
    const tx = d.x - e.x, ty = d.y + 0.05 - e.y, tz = d.z - e.z, t = tx * _dir.x + ty * _dir.y + tz * _dir.z;
    if (t < 0 || t > bd) return;
    if (Math.hypot(tx - _dir.x * t, ty - _dir.y * t, tz - _dir.z * t) < 0.45) { bd = t; best = i; }
  });
  if (best < 0) return false;
  const w = WEAPONS[G.drops[best].key];
  if (a.inv[w.slot]) dropWeapon(a, w.slot, true); // appended to the end, so `best` stays valid
  pickupDrop(a, best);
  equip(a, w.slot);
  return true;
}

// ============================================================ NOISE
function makeSound(src, x, z, radius, kind, fake) {
  for (const b of G.agents) {
    if (!b.bot || !b.alive || !hostile(b, src)) continue; // bots only react to enemy noise
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < radius) botHear(b, x, z, kind, d, fake ? null : src);
  }
}
function blindAgent(a, t, by) {
  a.blindT = Math.max(a.blindT, t); a.blindMax = Math.max(a.blindT, a.blindMax * 0.5); a.flashedBy = by;
  if (a.isPlayer) onPlayerFlashed(t);
  else if (a.bot) botFlashed(a);
}

// ============================================================ BOMB
function resetBomb() {
  if (G.bomb && G.bomb.mesh) FX.scene.remove(G.bomb.mesh);
  G.bomb = { state: 'carried', carrier: null, x: 0, y: 0, z: 0, timer: 0, beepT: 0, site: null, defuser: null, defuseT: 0, defuseTotal: DEFUSE_TIME, mesh: null, led: null };
  const m = gunModel('c4').group; m.scale.setScalar(1.5); m.visible = false; FX.scene.add(m);
  G.bomb.mesh = m;
}
function plantBomb(a) {
  const b = G.bomb;
  a.hasC4 = false; a.planting = 0;
  const f = dirFromAngles(a.yaw, 0);
  b.state = 'planted'; b.carrier = null; b.x = a.x + f.x * 0.35; b.z = a.z + f.z * 0.35; b.y = a.y;
  if (pointSolid(b.x, b.y + 0.1, b.z)) { b.x = a.x; b.z = a.z; }
  b.site = siteAt(a.x, a.z) || 'A'; b.timer = BOMB_TIME; b.beepT = 0; b.defuser = null; b.defuseT = 0; b.planter = a;
  G.phase = 'planted';
  addMoney(a, 300);
  if (a.isPlayer) trackEvent('objective', {});
  showMsg('The bomb has been planted', `Site ${b.site}`, 2.5, 't');
  SFX.play('planted');
  equip(a, bestSlot(a));
  for (const bot of G.agents) if (bot.bot && bot.alive) botBombPlanted(bot);
}
function updateBomb(dt) {
  const b = G.bomb;
  b.mesh.visible = b.state === 'dropped' || b.state === 'planted' || b.state === 'defused';
  if (b.mesh.visible) { b.mesh.position.set(b.x, b.y + 0.05, b.z); b.mesh.rotation.y = 0.3; }
  if (b.state !== 'planted' || G.phase !== 'planted') return;
  b.timer -= dt; b.beepT -= dt;
  if (b.beepT <= 0) {
    SFX.play('beep', { x: b.x, y: b.y + 0.2, z: b.z });
    b.beepT = b.timer > 10 ? clamp(b.timer / 40, 0.25, 1) : b.timer > 2 ? 0.2 : 0.08;
    FX.flashLight(b.x, b.y + 0.3, b.z, 0xff2020, 1.5, 0.12, 4);
    makeSound({ team: 'T' }, b.x, b.z, 30, 'bomb');
  }
  const d = b.defuser;
  if (d) {
    if (!d.alive || !d.defusing || Math.hypot(d.x - b.x, d.z - b.z) > 1.8) { b.defuser = null; b.defuseT = 0; if (d.alive) d.defusing = false; }
    else {
      b.defuseT += dt;
      if (Math.random() < dt * 6) SFX.play('defuse', { x: b.x, y: b.y, z: b.z });
      if (b.defuseT >= b.defuseTotal) {
        b.state = 'defused'; d.defusing = false; b.defuser = null;
        addMoney(d, 300); G.defuser = d;
        if (d.isPlayer) trackEvent('objective', {});
        SFX.play('defused');
        endRound('CT', 'Bomb defused');
        return;
      }
    }
  }
  if (b.timer <= 0) explodeBomb();
}
function startDefuse(a) {
  const b = G.bomb;
  if (b.defuser && b.defuser !== a) return false;
  if (!b.defuser) { b.defuser = a; b.defuseT = 0; b.defuseTotal = a.defuser ? KIT_DEFUSE_TIME : DEFUSE_TIME; }
  a.defusing = true; a.zoom = 0;
  return true;
}
function explodeBomb() {
  const b = G.bomb;
  b.state = 'exploded'; b.mesh.visible = false;
  SFX.play('explode', { x: b.x, y: b.y + 1, z: b.z });
  FX.flashLight(b.x, b.y + 3, b.z, 0xffa040, 80, 1.2, 60);
  for (let i = 0; i < 80; i++) FX.spawn({ kind: 'fireball', x: b.x + rand(-2, 2), y: b.y + rand(0, 3), z: b.z + rand(-2, 2), vx: rand(-9, 9), vy: rand(1, 12), vz: rand(-9, 9), life: rand(0.5, 1.2), max: 1.2, size: rand(1.5, 3.5), col: [1, 0.55, 0.2], a: 1, g: 2 });
  for (let i = 0; i < 40; i++) FX.spawn({ kind: 'smokepuff', x: b.x + rand(-3, 3), y: b.y + rand(0.5, 5), z: b.z + rand(-3, 3), vx: rand(-2, 2), vy: rand(1, 4), vz: rand(-2, 2), life: rand(3, 5), max: 5, size: rand(2.5, 4), grow: 1, col: [0.2, 0.19, 0.18], a: 0.8, rot: rand(0, TAU), g: 0 });
  shakeCamera(1.5);
  for (const a of G.agents) {
    if (!a.alive) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), sigma = 44.5 / 3;
    let dmg = 500 * Math.exp(-(d * d) / (2 * sigma * sigma));
    if (a.armor > 0) dmg *= 0.75;
    if (dmg >= 1) applyDamage(a, b.planter || null, 'c4', dmg, 'chest', { blast: true });
  }
  endRound('T', 'Target destroyed');
}

// ============================================================ ROUNDS
function isOvertime() { return RULES.overtime && G.roundsPlayed >= REG_HALF * 2; }
function sideSwapDue() {
  const r = G.roundsPlayed;
  if (r === REG_HALF) return true;
  return RULES.overtime && r > REG_HALF * 2 && (r - REG_HALF * 2) % OT_HALF === 0;
}
// who (if anyone) has won the match after the last round
function matchWinner() {
  const r = G.roundsPlayed, s = G.score;
  let tgt = REG_HALF + 1;
  if (!RULES.overtime && r >= REG_HALF * 2) return s.T > s.CT ? 'T' : s.CT > s.T ? 'CT' : 'draw';
  if (r > REG_HALF * 2) tgt = REG_HALF + OT_HALF * Math.floor((r - REG_HALF * 2 - 1) / (OT_HALF * 2)) + OT_HALF + 1;
  return s.T >= tgt ? 'T' : s.CT >= tgt ? 'CT' : null;
}
function startMatch() {
  nextId = 1;
  for (const a of G.agents) if (a.model) FX.scene.remove(a.model.root);
  G.agents = [];
  const pt = G.playerTeam, other = pt === 'T' ? 'CT' : 'T';
  G.player = makeAgent(pt, 'You', true);
  G.agents.push(G.player);
  // deathmatch still gives everyone a side, but only for the soldier model and buy list;
  // hostile() ignores it. Team modes use the mode's team size (Wingman: 2v2).
  const size = RULES.ffa ? Math.ceil((RULES.players || 10) / 2) : RULES.teamSize || 5;
  const mates = RULES.ffa ? (RULES.players || 10) - 1 - size : size - 1;
  for (let i = 0; i < mates; i++) G.agents.push(makeBot(pt, BOT_NAMES[pt][i]));
  for (let i = 0; i < size; i++) G.agents.push(makeBot(other, BOT_NAMES[other][i]));
  for (const a of G.agents) if (a.bot) rollBotCosmetics(a);
  for (const a of G.agents) { a.model = makeSoldierModel(a.team); FX.scene.add(a.model.root); }
  G.score = { T: 0, CT: 0 }; G.lossCount = { T: 0, CT: 0 }; G.round = 0; G.roundsPlayed = 0; G.time = 0;
  G.state = 'playing'; G.paused = false;
  if (typeof resetMatchLog === 'function') resetMatchLog();
  onMatchStart();
  startRound();
}
function swapSides(money) {
  for (const a of G.agents) {
    a.team = a.team === 'T' ? 'CT' : 'T';
    FX.scene.remove(a.model.root); a.model = makeSoldierModel(a.team); FX.scene.add(a.model.root);
    resetLoadout(a); a.money = money;
  }
  G.score = { T: G.score.CT, CT: G.score.T };
  G.lossCount = { T: 0, CT: 0 };
}
function resetLoadout(a) {
  a.inv = { primary: null, secondary: a.team === 'T' ? 'glock' : 'usp', knife: 'knife', taser: null };
  a.ammo = {}; giveWeapon(a, a.inv.secondary);
  a.skins = {}; a.skins[a.inv.secondary] = equippedSkin(a, a.inv.secondary);
  applyKnifeLoadout(a);
  for (const k of NADE_KEYS) a.nades[k] = 0;
  a.nadeSel = null; a.armor = 0; a.helmet = false; a.defuser = false; a.hasC4 = false;
}
// put an agent back on its feet with a clean per-life state (used by rounds and DM respawns)
function reviveAgent(a) {
  a.alive = true; a.hp = 100; a.deathT = 0; a.killer = null; a.hasC4 = false; a.dmgFrom = {}; a.roundDmg = 0;
  a.vx = a.vy = a.vz = 0; a.onGround = true; a.duck = false; a.duckAmt = 0; a.height = H_STAND; a.eye = EYE_STAND; a.tagMod = 1;
  a.reloadT = 0; a.drawT = 0; a.zoom = 0; a.rezoom = 0; a.recoilIdx = 0; a.inacc = 0; a.punchP = a.punchY = a.kickP = a.hurtP = a.hurtY = 0;
  a.blindT = 0; a.planting = 0; a.defusing = false; a.spottedT = -99; a.burnAcc = 0; a.muzzleT = 0;
}
function startRound() {
  if (RULES.ffa) { startDeathmatch(); return; } // deathmatch has one long "round" and respawns
  G.round++;
  let note = '';
  if (sideSwapDue()) {
    const ot = isOvertime();
    swapSides(ot ? OT_MONEY : START_MONEY);
    note = ot ? 'Overtime: switching sides' : 'Halftime: switching sides';
  } else if (RULES.overtime && G.roundsPlayed === REG_HALF * 2 || (isOvertime() && (G.roundsPlayed - REG_HALF * 2) % (OT_HALF * 2) === 0)) {
    for (const a of G.agents) { resetLoadout(a); a.money = OT_MONEY; }
    G.lossCount = { T: 0, CT: 0 };
    note = 'Overtime';
  }
  G.pistolRound = G.roundsPlayed === 0 || G.roundsPlayed === REG_HALF;
  G.phase = 'freeze'; G.phaseT = FREEZE_TIME; G.roundT = ROUND_TIME;
  G.intel = { A: -99, B: -99 }; G.roundKills = {}; G.defuser = null; G.mvp = null;
  FX.reset();
  for (const d of G.drops) FX.scene.remove(d.mesh);
  G.drops.length = 0;
  resetBomb();
  const used = [];
  for (const a of G.agents) {
    if (!a.alive || !a.inv.secondary && !a.inv.primary) {
      const keepMoney = a.money; resetLoadout(a); a.money = keepMoney;
    } else {
      for (const k of [a.inv.primary, a.inv.secondary]) if (k) a.ammo[k] = { mag: WEAPONS[k].mag, res: WEAPONS[k].reserve };
    }
    reviveAgent(a); a.roundsPlayed++;
    const s = randomWalkableIn(SPAWN_ZONES[a.team], used); used.push(s);
    a.x = s.x; a.y = s.y; a.z = s.z;
    // face roughly toward the other team's spawn (i.e. toward the action)
    const oz = SPAWN_ZONES[a.team === 'T' ? 'CT' : 'T'];
    a.yaw = yawTo(a.x, a.z, (oz.x0 + oz.x1) / 2, (oz.z0 + oz.z1) / 2) + rand(-0.3, 0.3); a.pitch = 0;
    if (RULES.freeArmor) { a.armor = 100; a.helmet = true; if (a.team === 'CT') a.defuser = true; }
    a.slot = ''; equip(a, bestSlot(a)); a.drawT = 0;
    a.model.deathT = 0;
  }
  // C4 goes to the player if they're a T, otherwise a random T
  const ts = G.agents.filter((a) => a.team === 'T');
  const carrier = G.player.team === 'T' ? G.player : pick(ts);
  carrier.hasC4 = true; G.bomb.carrier = carrier;
  for (const a of G.agents) if (a.bot) botBuy(a);
  botsNewRound();
  const pt = G.player.team, sites = activeSites().join(' and ');
  showMsg(note || (G.pistolRound ? 'Pistol round' : `Round ${G.round}`), pt === 'T' ? 'Buy phase: B to buy. You carry the C4.' : `Buy phase: B to buy. Defend ${sites}.`, 3.5, note ? pt.toLowerCase() : '');
  closeBuy(true);
}
function endRound(winner, reason) {
  if (G.phase === 'over') return;
  G.phase = 'over'; G.phaseT = ROUND_END_TIME;
  const loser = winner === 'T' ? 'CT' : 'T';
  G.score[winner]++; G.roundsPlayed++; G.lastWinner = winner;
  // loss bonus ladder: a win steps it down one level, a loss steps it up
  G.lossCount[winner] = Math.max(0, G.lossCount[winner] - 1);
  G.lossCount[loser] = Math.min(G.lossCount[loser] + 1, 5);
  const winMoney = reason === 'Target destroyed' || reason === 'Bomb defused' ? 3500 : 3250;
  const lossMoney = 1400 + 500 * (G.lossCount[loser] - 1);
  const planted = G.bomb.state === 'planted' || G.bomb.state === 'defused' || G.bomb.state === 'exploded';
  for (const a of G.agents) {
    if (a.team === winner) addMoney(a, winMoney);
    else if (reason === 'Time ran out' && a.team === 'T' && a.alive) { /* surviving attackers get nothing when time runs out */ }
    else addMoney(a, lossMoney + (a.team === 'T' && planted ? 800 : 0));
    a.planting = 0; a.defusing = false;
  }
  // round MVP
  let mvp = null;
  if (reason === 'Bomb defused') mvp = G.defuser;
  else if (reason === 'Target destroyed') mvp = G.bomb.planter;
  if (!mvp) { let best = 0; for (const a of G.agents) if (a.team === winner && (G.roundKills[a.id] || 0) > best) { best = G.roundKills[a.id]; mvp = a; } }
  if (mvp) { mvp.mvps++; G.mvp = mvp; }
  const mine = winner === G.player.team;
  if (mine) trackEvent('roundwin', { map: MAP_INFO.id });
  showMsg(winner === 'T' ? 'Attackers win' : 'Defenders win', reason + (mvp ? ` · MVP: ${mvp.name}` : ''), ROUND_END_TIME, winner === 'T' ? 't' : 'ct');
  SFX.play(mine ? 'win' : 'lose');
}
function updateRound(dt) {
  if (RULES.ffa) { updateDeathmatch(dt); return; }
  if (G.phase === 'freeze') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) { G.phase = 'live'; G.liveT = G.time; SFX.play('go'); showMsg('', '', 0); }
    return;
  }
  if (G.phase === 'over') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) {
      if (matchWinner()) endMatch(); else startRound();
    }
    return;
  }
  if (G.phase === 'live') { G.roundT -= dt; if (G.roundT <= 0) { G.roundT = 0; endRound('CT', 'Time ran out'); return; } }
  const aT = aliveOf('T').length, aCT = aliveOf('CT').length;
  if (aCT === 0 && G.phase !== 'over') { endRound('T', 'Enemies eliminated'); return; }
  if (aT === 0 && G.phase === 'live') { endRound('CT', 'Enemies eliminated'); return; }
}
// In deathmatch the "buy time" is a short free-pick window after each (re)spawn, per agent.
function buyTimeLeft(a) {
  if (RULES.ffa) {
    a = a || G.player;
    if (G.phase === 'freeze') return DM_PICK_TIME;
    return G.phase === 'live' ? DM_PICK_TIME - (G.time - Math.max(a.spawnT || 0, G.liveT || 0)) : 0;
  }
  return G.phase === 'freeze' ? BUY_TIME : G.phase === 'live' ? BUY_TIME - (G.time - G.liveT) : 0;
}
function inBuyZone(a) {
  if (RULES.ffa) return true; // you pick where you spawn
  const z = SPAWN_ZONES[a.team];
  return a.x > z.x0 - 10 && a.x < z.x1 + 4 && a.z > z.z0 - 4 && a.z < z.z1 + 4;
}
const canBuy = (a) => a.alive && G.state === 'playing' && buyTimeLeft(a) > 0 && inBuyZone(a);
// deathmatch: what the buy menu offers (guns only; armor is free and there are no grenades)
const DM_BUY_CATS = ['Pistols', 'Mid-tier', 'Rifles'];
const buyCats = (a) => (RULES.ffa ? BUY_MENU[a.team].filter(([cat]) => DM_BUY_CATS.includes(cat)) : BUY_MENU[a.team]);
function buyItem(a, item) {
  if (!canBuy(a)) return false;
  const w = WEAPONS[item], gear = GEAR[item];
  if (RULES.ffa) {
    // free pick: swap the gun in place (no drop, so the map doesn't fill with guns) and
    // remember it so the next life starts with the same loadout
    if (!w || (w.slot !== 'primary' && w.slot !== 'secondary') || (w.team && w.team !== a.team) || a.inv[w.slot] === item) return false;
    dmGive(a, item); a.dmPick = a.dmPick || {}; a.dmPick[w.slot] = item;
    equip(a, w.slot, true);
    return true;
  }
  if (w) {
    if ((w.team && w.team !== a.team) || a.money < w.price) return false;
    if (w.slot === 'grenade') {
      if (a.nades[item] >= w.max || nadeCount(a) >= MAX_NADES) return false;
      a.money -= w.price; giveWeapon(a, item); return true;
    }
    if (a.inv[w.slot] === item) return false;
    a.money -= w.price;
    if (a.inv[w.slot]) dropWeapon(a, w.slot, true);
    giveWeapon(a, item);
    a.skins[item] = equippedSkin(a, item);
    equip(a, w.slot, true);
    return true;
  }
  if (gear) {
    if (gear.team && gear.team !== a.team) return false;
    let price = gear.price;
    if (item === 'vesthelm' && a.armor >= 100) price = 350;
    if ((item === 'vest' && a.armor >= 100) || (item === 'vesthelm' && a.armor >= 100 && a.helmet) || (item === 'defuser' && a.defuser) || a.money < price) return false;
    a.money -= price;
    if (item === 'vest') a.armor = 100;
    if (item === 'vesthelm') { a.armor = 100; a.helmet = true; }
    if (item === 'defuser') a.defuser = true;
    return true;
  }
  return false;
}
// ============================================================ DEATHMATCH
const DM_BOT_GUNS = {
  T: ['ak47', 'ak47', 'ak47', 'galil', 'sg553', 'mac10', 'mp7', 'p90', 'xm1014', 'awp', 'ssg08'],
  CT: ['m4a4', 'm4a1s', 'm4a4', 'famas', 'aug', 'mp9', 'ump45', 'p90', 'xm1014', 'awp', 'ssg08'],
};
const DM_BOT_PISTOLS = { T: ['glock', 'glock', 'p250', 'tec9', 'deagle'], CT: ['usp', 'usp', 'p250', 'fiveseven', 'deagle'] };
// replace whatever is in the gun's slot with a fresh copy of it
function dmGive(a, key) {
  const w = WEAPONS[key], old = a.inv[w.slot];
  if (old) delete a.ammo[old];
  a.inv[w.slot] = null; giveWeapon(a, key);
  a.skins[key] = equippedSkin(a, key);
}
// A random walkable point that no living enemy can see. Candidates are scored by distance to
// the nearest enemy; a visible point is only used if nothing hidden turns up.
function dmSpawnPoint(a, used) {
  const whole = { x0: 2, x1: MAP_W - 2, z0: 2, z1: MAP_D - 2 };
  const foes = G.agents.filter((e) => e.alive && hostile(a, e));
  let best = null, bestScore = -1e9;
  for (let i = 0; i < 40; i++) {
    const c = randomWalkableIn(whole, used);
    if (Math.abs(c.y) > 4) continue; // skip rooftops and other odd high spots
    let near = 1e9, seen = false;
    for (const e of foes) {
      const d = Math.hypot(e.x - c.x, e.z - c.z);
      near = Math.min(near, d);
      if (!seen && d < 70 && losClear(e.x, e.y + e.eye, e.z, c.x, c.y + 1.4, c.z)) seen = true;
    }
    const score = Math.min(near, 30) - (seen ? 100 : 0);
    if (!seen && near > 8) return c;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || randomWalkableIn(whole, used);
}
function dmSpawn(a, used) {
  reviveAgent(a);
  resetLoadout(a);
  // free loadout every life: the player keeps their last free pick, bots roll a gun
  const guns = a.isPlayer ? a.dmPick || {} : { primary: pick(DM_BOT_GUNS[a.team]), secondary: pick(DM_BOT_PISTOLS[a.team]) };
  dmGive(a, guns.primary || (a.team === 'T' ? 'ak47' : 'm4a4'));
  if (guns.secondary && guns.secondary !== a.inv.secondary) dmGive(a, guns.secondary);
  a.armor = 100; a.helmet = true;
  const s = dmSpawnPoint(a, used || []); if (used) used.push(s);
  a.x = s.x; a.y = s.y; a.z = s.z;
  a.yaw = yawTo(a.x, a.z, MAP_W / 2, MAP_D / 2) + rand(-0.6, 0.6); a.pitch = 0;
  a.spawnT = G.time; a.protectT = G.time + DM_PROTECT; a.respawnAt = 0;
  a.slot = ''; equip(a, bestSlot(a)); a.drawT = 0;
  if (a.model) a.model.deathT = 0;
  if (a.bot) botDMSpawn(a);
  if (a.isPlayer) { a.pinPulled = false; showMsg('', 'B: pick your guns (free) · spawn protection until you shoot', 2.2); }
}
function startDeathmatch() {
  G.round = 1; G.roundsPlayed = 0;
  G.phase = 'freeze'; G.phaseT = FREEZE_TIME; G.roundT = ROUND_TIME; G.liveT = G.time + FREEZE_TIME;
  G.intel = { A: -99, B: -99 }; G.roundKills = {}; G.defuser = null; G.mvp = null; G.dmWinner = null;
  FX.reset();
  for (const d of G.drops) FX.scene.remove(d.mesh);
  G.drops.length = 0;
  resetBomb(); G.bomb.state = 'none'; // no bomb: hides it everywhere (radar, HUD, pickups)
  const used = [];
  for (const a of G.agents) { a.roundsPlayed = 1; dmSpawn(a, used); }
  showMsg('Deathmatch', `Everyone is an enemy · first to ${RULES.killLimit} kills · B: pick your guns`, 3.5);
  closeBuy(true);
}
// leaderboard order: most kills, then fewest deaths
const dmRanking = () => G.agents.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
function updateDeathmatch(dt) {
  if (G.phase === 'freeze') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) { G.phase = 'live'; G.liveT = G.time; SFX.play('go'); }
    return;
  }
  // the free-pick menu blocks movement, so close it once the pick window is over
  if (G.buyOpen && !canBuy(G.player)) closeBuy(false);
  // respawns keep running in the short end phase too, so nobody is left spectating
  for (const a of G.agents) if (!a.alive && a.respawnAt && G.time >= a.respawnAt) dmSpawn(a);
  // guns dropped by the dead only lie around briefly
  for (let i = G.drops.length - 1; i >= 0; i--) if (G.time - G.drops[i].t > DM_DROP_LIFE) { FX.scene.remove(G.drops[i].mesh); G.drops.splice(i, 1); }
  if (G.phase === 'over') {
    G.phaseT -= dt;
    if (G.phaseT <= 0) endMatch();
    return;
  }
  G.roundT -= dt;
  const leader = dmRanking()[0];
  if (leader.kills >= RULES.killLimit || G.roundT <= 0) {
    G.roundT = Math.max(0, G.roundT);
    G.phase = 'over'; G.phaseT = ROUND_END_TIME; G.dmWinner = leader;
    closeBuy(true);
    showMsg(leader.isPlayer ? 'You win the deathmatch' : `${leader.name} wins the deathmatch`, `${leader.kills} kills`, ROUND_END_TIME, leader.isPlayer ? 'ct' : 't');
    SFX.play(leader.isPlayer ? 'win' : 'lose');
  }
}

function shakeCamera(k) { CAM.shake = Math.max(CAM.shake, k); }

// ============================================================ UPDATE
function updateGame(dt) {
  updateRound(dt);
  if (G.state !== 'playing') return;
  for (const a of G.agents) if (a.alive) updateWeapon(a, dt);
  updatePlayer(dt);
  for (const a of G.agents) if (a.bot && a.alive) updateBot(a, dt);
  separateAgents();
  updateBomb(dt);
  updateDrops(dt);
}

// knife + bot cosmetics
function applyKnifeLoadout(a) {
  if (a.isPlayer && typeof PROFILE !== 'undefined') {
    const id = PROFILE.equipped.knife[a.team];
    if (id) { const [, t, f] = id.split(':'); a.knifeType = t; a.knifeFinish = f; } else { a.knifeType = 'combat'; a.knifeFinish = null; }
  } else if (a.botKnife) { a.knifeType = a.botKnife[0]; a.knifeFinish = a.botKnife[1]; }
  else { a.knifeType = 'combat'; a.knifeFinish = null; }
}
function rollBotCosmetics(a) {
  a.botSkins = {};
  for (const k of SKINNABLE) if (Math.random() < 0.22) a.botSkins[k] = pick(Object.keys(FINISHES).filter((f) => f !== 'factory'));
  a.botKnife = Math.random() < 0.3 ? [pick(Object.keys(KNIFE_TYPES).filter((t) => t !== 'combat')), pick(Object.keys(FINISHES))] : null;
}
