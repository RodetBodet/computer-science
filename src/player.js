'use strict';
/* =====================================================================
   PLAYER: input, controls, camera and the first-person viewmodel.
   ===================================================================== */
const keys = {}, pressed = new Set();
const mouse = { left: false, right: false, leftDown: false, rightDown: false, leftUp: false, rightUp: false, dx: 0, dy: 0 };
const INPUT = { jump: 0 };

function updatePlayer(dt) {
  const p = G.player;
  if (!p.alive) { mouse.dx = mouse.dy = 0; return; }
  const w = curWeapon(p);
  // ---- look (classic 0.022 degrees per mouse count) ----
  const zoomRatio = p.zoom && w.scope ? fov43(w.scope[p.zoom - 1]) / fov43(90) : 1;
  const k = G.sens * 0.022 * DEG * zoomRatio;
  p.yaw = angNorm(p.yaw - mouse.dx * k);
  p.pitch = clamp(p.pitch - mouse.dy * k, -89 * DEG, 89 * DEG);
  VM.swayX += mouse.dx; VM.swayY += mouse.dy;
  mouse.dx = 0; mouse.dy = 0;
  const frozen = G.phase === 'freeze' || p.planting > 0 || p.defusing;
  // ---- move ----
  p.duck = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight);
  p.walking = !!(keys.ShiftLeft || keys.ShiftRight);
  let f = 0, s = 0;
  if (!G.buyOpen && !frozen) {
    if (keys.KeyW) f++; if (keys.KeyS) f--; if (keys.KeyD) s++; if (keys.KeyA) s--;
  }
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * f + cy * s, wz = -cy * f - sy * s;
  const wl = Math.hypot(wx, wz); if (wl) { wx /= wl; wz /= wl; }
  const jump = INPUT.jump > 0 && p.onGround && !frozen && !G.buyOpen;
  if (jump) INPUT.jump = 0;
  physicsStep(p, wx, wz, jump, dt);
  footsteps(p, dt);
  // ---- weapon ----
  const busy = G.buyOpen || G.phase === 'freeze';
  if (!busy) {
    if (w.cat === 'grenade') {
      if ((mouse.leftDown || mouse.rightDown) && canAttack(p)) { p.pinPulled = true; SFX.play('pin'); }
      if (p.pinPulled && !mouse.left && !mouse.right) {
        const power = p.pinL && p.pinR ? 0.5 : p.pinL ? 1 : 0.3;
        p.pinPulled = false; p.pinL = p.pinR = false;
        throwNade(p, power);
      }
      if (p.pinPulled) { if (mouse.left) p.pinL = true; if (mouse.right) p.pinR = true; }
    } else if (w.cat === 'c4') {
      updatePlanting(p, dt, mouse.left);
    } else {
      if (mouse.left && (w.auto ? true : mouse.leftDown) && canAttack(p)) fireWeapon(p);
      else if (mouse.leftDown && !canAttack(p) && p.ammo[p.weaponKey] && p.ammo[p.weaponKey].mag === 0 && p.reloadT <= 0) { SFX.play('empty'); startReload(p); }
      if (mouse.rightDown) {
        if (w.scope && p.reloadT <= 0 && p.drawT <= 0) { p.zoom = (p.zoom + 1) % (w.scope.length + 1); p.rezoom = 0; SFX.play('zoom'); }
        else if (w.cat === 'knife' && canAttack(p)) knifeAttack(p, true);
      }
    }
  }
  // E: defuse, or pick up the gun you look at
  if (keys.KeyE && p.team === 'CT' && G.bomb.state === 'planted' && G.phase === 'planted' && Math.hypot(p.x - G.bomb.x, p.z - G.bomb.z) < 1.6 && Math.abs(p.y - G.bomb.y) < 1.5) {
    if (!p.defusing) startDefuse(p);
    if (Math.random() < dt * 1.5) makeSound(p, p.x, p.z, 16, 'defuse');
  } else if (p.defusing) { p.defusing = false; }
  if (keys.KeyE && p.team === 'T' && p.hasC4 && plantSiteAt(p.x, p.z) && w.cat !== 'c4') equip(p, 'c4');
  if (pressed.has('KeyE')) tryUseWeapon(p);
  mouse.leftDown = mouse.rightDown = false;
  // spot enemies for the radar
  for (const e of G.agents) {
    if (!e.alive || !hostile(p, e)) continue;
    const off = Math.abs(angNorm(yawTo(p.x, p.z, e.x, e.z) - p.yaw));
    if (p.blindT < 0.5 && off < 60 * DEG && losClear(p.x, p.y + p.eye, p.z, e.x, e.y + 1.4, e.z) && !smokeBlocks(p.x, p.y + p.eye, p.z, e.x, e.y + 1.4, e.z)) e.spottedT = G.time;
  }
  pressed.clear();
}
function updatePlanting(p, dt, holding) {
  const ok = holding && plantSiteAt(p.x, p.z) && p.onGround && G.phase === 'live' && p.drawT <= 0;
  if (ok) {
    if (!p.planting) p.planting = 0.0001;
    p.planting += dt;
    if (Math.random() < dt * 5) SFX.play('plantkey');
    if (p.planting >= PLANT_TIME) plantBomb(p);
  } else {
    if (holding && !plantSiteAt(p.x, p.z) && mouse.leftDown) showMsg('', siteAt(p.x, p.z) ? `Planting is only allowed on ${activeSites().join(' or ')} in this mode` : 'You must be on a bombsite to plant the C4', 1.5);
    p.planting = 0;
  }
}

// ---------------------------------------------------------- input
function lockPointer() { try { const r = RENDER.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
function initInput() {
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === RENDER.canvas;
    if (locked) { G.paused = false; $('pause').classList.add('hidden'); }
    else if (G.state === 'playing' && !G.buyOpen) { G.paused = true; $('pause').classList.remove('hidden'); for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; }
  });
  document.addEventListener('mousemove', (e) => { if (document.pointerLockElement === RENDER.canvas) { mouse.dx += e.movementX; mouse.dy += e.movementY; } });
  RENDER.canvas.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing') return;
    if (document.pointerLockElement !== RENDER.canvas && !G.buyOpen) { lockPointer(); return; }
    if (e.button === 0) { mouse.left = true; mouse.leftDown = true; if (!G.player.alive) G.specIdx++; }
    if (e.button === 2) { mouse.right = true; mouse.rightDown = true; if (!G.player.alive) G.specIdx--; }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  window.addEventListener('contextmenu', (e) => { if (G.state === 'playing') e.preventDefault(); });
  window.addEventListener('wheel', (e) => {
    if (G.state !== 'playing' || G.buyOpen || !G.player.alive) return;
    const p = G.player, order = ['primary', 'secondary', 'knife', 'grenade', 'c4'].filter((s) => slotKey(p, s));
    const i = order.indexOf(p.slot);
    equip(p, order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length]);
  }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (G.state !== 'playing') return;
    if (['Tab', 'Space'].includes(e.code) || e.ctrlKey) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    pressed.add(e.code);
    const p = G.player;
    if (e.code === 'Tab') { G.boardOpen = true; $('scoreboard').classList.remove('hidden'); }
    if (G.buyOpen) { buyKey(e); return; }
    if (e.code === 'Space') INPUT.jump = 1;
    if (!p.alive) return;
    if (e.code === 'KeyB') openBuy();
    if (e.code === 'KeyR') startReload(p);
    if (e.code === 'KeyF') { if (p.reloadT <= 0 && p.drawT <= 0) p.inspectT = 2.6; }
    if (e.code === 'Digit1') equip(p, 'primary');
    if (e.code === 'Digit2') equip(p, 'secondary');
    if (e.code === 'Digit3') { if (p.slot === 'knife' && p.inv.taser) equip(p, 'taser'); else equip(p, 'knife'); }
    if (e.code === 'Digit4') cycleGrenade(p);
    if (e.code === 'Digit5') equip(p, 'c4');
    if (e.code === 'KeyQ') equip(p, slotKey(p, p.lastSlot) ? p.lastSlot : bestSlot(p));
    if (e.code === 'KeyG') {
      if (p.slot === 'c4') { dropC4(p); SFX.play('deploy'); }
      else if (p.slot === 'primary' || p.slot === 'secondary') { dropWeapon(p, p.slot, true); SFX.play('deploy'); }
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Tab') { G.boardOpen = false; $('scoreboard').classList.add('hidden'); }
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });
}

// ---------------------------------------------------------- camera
function viewAgent() {
  const p = G.player;
  if (G.state !== 'playing') return null;
  if (p.alive) return p;
  if (G.time - p.deathT < 2.5) return null; // death cam
  let list = RULES.ffa ? [] : G.agents.filter((a) => a.alive && a.team === p.team); // FFA: no teammates to follow
  if (!list.length) list = G.agents.filter((a) => a.alive);
  if (!list.length) return null;
  return list[((G.specIdx % list.length) + list.length) % list.length];
}
function updateCamera(dt, camera) {
  if (G.state !== 'playing' && typeof updateShowcase === 'function' && updateShowcase(dt, camera)) { CAM.view = null; return; }
  if (G.state !== 'playing') {
    // slow fly-over of A site behind the menu
    const t = G.menuT * 0.05;
    camera.position.set(60 + Math.sin(t) * 6, 7 + Math.sin(t * 0.7), 30 + Math.cos(t) * 4);
    camera.lookAt(64 + Math.sin(t * 1.3) * 3, 1, 10);
    CAM.view = null;
    camera.fov = 70; camera.updateProjectionMatrix();
    return;
  }
  const v = viewAgent();
  CAM.view = v;
  let x, y, z, yaw, pitch, fov = fov43(90);
  if (v) {
    x = v.x; y = v.y + v.eye; z = v.z;
    yaw = v.yaw + (v.punchY + v.hurtY) * DEG; pitch = v.pitch + (v.punchP + v.kickP + v.hurtP) * DEG;
    const w = curWeapon(v);
    if (v.zoom && w.scope) fov = fov43(w.scope[v.zoom - 1]);
    if (v !== G.player) { CAM.specYaw = CAM.specYaw === undefined ? yaw : CAM.specYaw + angNorm(yaw - CAM.specYaw) * Math.min(1, dt * 14); yaw = CAM.specYaw; }
  } else {
    // death cam: drop down and turn toward the killer
    const p = G.player, kk = Math.min(1, (G.time - p.deathT) / 0.7);
    x = p.x; z = p.z; y = p.y + lerp(p.eye, 0.35, kk);
    yaw = CAM.yaw; pitch = lerp(CAM.pitch, 0.1, Math.min(1, dt * 3));
    if (p.killer && p.killer !== p) yaw = angNorm(CAM.yaw + angNorm(yawTo(p.x, p.z, p.killer.x, p.killer.z) - CAM.yaw) * Math.min(1, dt * 3));
  }
  if (CAM.shake > 0) { CAM.shake = Math.max(0, CAM.shake - dt); yaw += (Math.random() - 0.5) * 0.05 * CAM.shake; pitch += (Math.random() - 0.5) * 0.05 * CAM.shake; }
  CAM.yaw = yaw; CAM.pitch = pitch;
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  CAM.pos.set(x, y, z);
  SFX.setListener(x, y, z, yaw);
  SFX.updateAmbience(x, z, !G.paused);
  // hide whoever we're looking through (and our own body while the death cam sits inside it)
  for (const a of G.agents) if (a.model) a.model.root.visible = a !== v && !(a === G.player && !v);
}

// ---------------------------------------------------------- viewmodel
const VM = {
  scene: null, cam: null, root: null, key: null, team: null, gun: null, swayX: 0, swayY: 0, sx: 0, sy: 0, kick: 0, lastShot: -9, bob: 0, landT: 0,
  init() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(fov43(68), innerWidth / innerHeight, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xdfe8ff, 0x6a5a48, 1.2); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 1.6); this.sun.position.set(0.6, 1, 0.3); this.scene.add(this.sun);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: FX_TEX.flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.12, 0.12, 0.12);
    this.flash.material.color.setRGB(9, 6.5, 3.5); // HDR so it blooms
  },
  build(key, team, cos) {
    this.key = key; this.team = team; this.sig = cosKey(key, cos);
    this.root.clear();
    const w = WEAPONS[key], info = gunModel(key, cos);
    this.knifeType = key === 'knife' ? (cos && cos.knife) || 'combat' : null;
    this.gun = info;
    const holder = new THREE.Group(); this.root.add(holder); this.holder = holder;
    holder.add(info.group);
    const type = w.model.type;
    const pose = type === 'pistol' || type === 'taser' ? [0.12, -0.15, -0.42] : type === 'knife' ? [0.15, -0.15, -0.36] : type === 'nade' ? [0.14, -0.15, -0.36] : type === 'c4' ? [0.02, -0.22, -0.42] : [0.14, -0.16, -0.38];
    holder.position.set(...pose);
    holder.rotation.set(type === 'knife' ? 0.25 : 0, type === 'knife' ? 0.5 : 0.045, type === 'knife' ? -0.4 : 0);
    this.basePos = holder.position.clone(); this.baseRot = holder.rotation.clone();
    // arms (children of the gun so they follow every animation)
    const sleeve = soldierMat(team, 'jacket'), glove = soldierMat(team, 'glove');
    const arm = (from, to, thick) => {
      const d = new THREE.Vector3().subVectors(to, from), L = d.length();
      const m = new THREE.Mesh(new THREE.BoxGeometry(thick, L, thick * 1.1), sleeve);
      m.position.copy(from).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(_up, d.normalize()); info.group.add(m);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(thick * 1.1, 0.03, thick * 1.2), soldierMat(team, 'band'));
      cuff.position.copy(to).addScaledVector(d, -0.07); cuff.quaternion.copy(m.quaternion); info.group.add(cuff);
    };
    const hand = (pos, sx) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.045 * (sx || 1), 0.06, 0.08), glove); h.position.copy(pos); info.group.add(h);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.06), glove); fingers.position.copy(pos).add(new THREE.Vector3(0, -0.035, -0.015)); info.group.add(fingers);
    };
    const grip = new THREE.Vector3(0.012, -0.035, 0.03);
    arm(new THREE.Vector3(0.1, -0.24, 0.32), grip.clone().add(new THREE.Vector3(0, 0, 0.03)), 0.065);
    hand(grip);
    if (type !== 'knife' && type !== 'nade') {
      const fore = info.fore.clone().add(new THREE.Vector3(-0.012, -0.03, 0));
      arm(new THREE.Vector3(-0.2, -0.26, fore.z + 0.36), fore.clone().add(new THREE.Vector3(0, -0.01, 0.03)), 0.065);
      hand(fore);
    }
    this.muzzle = new THREE.Object3D(); this.muzzle.position.copy(info.muzzle); info.group.add(this.muzzle);
    this.muzzle.add(this.flash);
    this.magBase = info.mag ? info.mag.position.clone() : null;
  },
  update(dt, v) {
    if (!v || !v.alive || G.state !== 'playing') { this.root.visible = false; return; }
    const w = curWeapon(v);
    const scoped = v.zoom && w.scope;
    this.root.visible = !scoped;
    const cos = cosmeticFor(v, v.weaponKey);
    if (this.sig !== cosKey(v.weaponKey, cos) || this.team !== v.team) this.build(v.weaponKey, v.team, cos);
    const h = this.holder, pos = this.basePos.clone(), rot = this.baseRot.clone();
    // bob + sway
    const sp = Math.hypot(v.vx, v.vz), amp = clamp(sp / 5.5, 0, 1) * (v.onGround ? 1 : 0.2);
    this.bob += sp * dt * 1.9;
    pos.x += Math.sin(this.bob) * 0.006 * amp; pos.y += -Math.abs(Math.cos(this.bob)) * 0.008 * amp;
    this.sx = lerp(this.sx, clamp(-this.swayX * 0.0007, -0.05, 0.05), Math.min(1, dt * 10)); this.sy = lerp(this.sy, clamp(-this.swayY * 0.0007, -0.05, 0.05), Math.min(1, dt * 10));
    this.swayX = 0; this.swayY = 0;
    rot.y += this.sx; rot.x += this.sy; pos.x += this.sx * 0.08;
    if (!v.onGround) pos.y += 0.01;
    pos.y -= v.duckAmt * 0.004;
    // recoil kick
    if (v.lastShotT !== this.lastShot) { this.lastShot = v.lastShotT; this.kick = 1; }
    this.kick *= Math.exp(-dt * 16);
    const kickAmt = w.cat === 'sniper' || w.cat === 'heavy' ? 2.2 : w.cat === 'pistol' ? 1.3 : 1;
    pos.z += this.kick * 0.022 * kickAmt; rot.x += this.kick * 0.035 * kickAmt;
    // draw
    if (v.drawT > 0) { const t = v.drawT / w.deploy; pos.y -= t * t * 0.22; rot.x -= t * 0.7; }
    // reload
    if (this.gun.mag && this.magBase) this.gun.mag.position.copy(this.magBase), this.gun.mag.visible = true;
    if (v.reloadT > 0) {
      const r = 1 - v.reloadT / v.reloadTotal, d = Math.sin(r * Math.PI);
      if (v.shellReload) { rot.z += 0.35; rot.x += 0.15 + Math.sin(r * Math.PI) * 0.08; pos.y -= 0.02; }
      else {
        rot.z += d * 0.55; rot.x += d * 0.22; pos.y -= d * 0.04;
        if (this.gun.mag && this.magBase) {
          if (r < 0.42) { this.gun.mag.position.y = this.magBase.y - (r / 0.42) * 0.3; this.gun.mag.visible = r < 0.38; }
          else if (r < 0.78) this.gun.mag.position.y = this.magBase.y - (1 - (r - 0.42) / 0.36) * 0.25;
        }
      }
    }
    // inspect: every knife type has its own move
    if (v.inspectT > 0) {
      const t = 1 - v.inspectT / 2.6, e = Math.sin(t * Math.PI), kt = this.knifeType;
      if (kt === 'butterfly') { rot.x += Math.sin(t * Math.PI * 6) * 0.25 * e; this.gun.group.rotation.z = smoothstep(0.1, 0.9, t) * TAU * 3; pos.y += e * 0.03; rot.y -= e * 0.5; }
      else if (kt === 'karambit') { this.gun.group.rotation.x = smoothstep(0.15, 0.75, t) * TAU * 2; rot.z += e * 0.3; pos.x -= e * 0.04; }
      else if (kt === 'bowie') { rot.y -= e * 1.1; rot.x -= e * 0.35; pos.x -= e * 0.07; pos.y += e * 0.04; }
      else if (kt) { rot.y -= e * 0.8; this.gun.group.rotation.z = smoothstep(0.35, 0.65, t) * Math.PI; pos.y += e * 0.03; }
      else { rot.y -= e * 0.9; rot.z += e * 0.45; pos.x -= e * 0.05; pos.y += e * 0.02; }
    } else if (this.gun && this.knifeType) { this.gun.group.rotation.z = 0; this.gun.group.rotation.x = 0; }
    // knife swing / throw / plant
    if (v.knifeT > 0) { const t = 1 - v.knifeT / 0.45, e = Math.sin(clamp(t, 0, 1) * Math.PI); rot.z += e * 1.2; rot.y += e * 0.8; pos.x -= e * 0.12; pos.z -= e * 0.05; }
    if (v.throwT > 0) { const t = 1 - v.throwT / 0.4; pos.z -= Math.sin(t * Math.PI) * 0.12; pos.y += Math.sin(t * Math.PI) * 0.06 - t * 0.3; rot.x += t * 0.6; }
    if (v.pinPulled) { pos.y += 0.03; pos.x -= 0.02; rot.x += 0.1; }
    if (v.planting > 0) { pos.y -= 0.06; rot.x -= 0.5; pos.z -= 0.03 + Math.sin(G.time * 18) * 0.004; }
    h.position.copy(pos); h.rotation.copy(rot);
    // muzzle flash
    this.flash.visible = v.muzzleT > 0 && !w.silenced;
    if (this.flash.visible) { this.flash.material.rotation = Math.random() * TAU; const s = (w.cat === 'pistol' ? 0.1 : 0.15) * rand(0.8, 1.3); this.flash.scale.set(s, s, s); }
    // lighting follows the space you're in
    const indoor = isIndoors(v.x, v.z) ? 0.5 : 1;
    this.hemi.intensity = 1.1 * (0.6 + 0.4 * indoor); this.sun.intensity = 1.7 * indoor;
  },
};

// ---------------------------------------------------------- player feedback
function onPlayerHurt(att, dmg, info) {
  SFX.play(G.player.armor > 0 ? 'armor' : 'hurt');
  const v = $('dmg-vignette'); v.style.opacity = clamp(0.25 + dmg / 70, 0, 0.9);
  if (att && att !== G.player) {
    const rel = angNorm(yawTo(G.player.x, G.player.z, att.x, att.z) - G.player.yaw);
    const el = $('dmg-dir'); el.style.transform = `translate(-50%,-50%) rotate(${-rel}rad)`; el.style.opacity = 1;
    HUD.dmgDirT = 1.3;
  }
}
function onPlayerDeath() {
  mouse.left = mouse.right = false; G.player.pinPulled = false; G.specIdx = 0;
  closeBuy(true);
}
function onPlayerFlashed(t) {
  RENDER.captureAfterimage = true;
  if (t > 1.5) SFX.play('ring', null, t);
}
