'use strict';
/* =====================================================================
   EFFECTS + GRENADES
   - SpriteBatch: instanced camera-facing quads (smoke, fire, dust, sparks)
   - volumetric smoke: flood-filled voxels that squeeze into rooms and
     corridors, get holes punched by bullets and cleared by HE grenades
   - molotov / incendiary fire that smoke can extinguish
   - flashbangs, HE, decoys, bullet decals, tracers, lights
   ===================================================================== */
const FX_TEX = {};
const GRAV_NADE = 8.13; // grenade gravity (40% of player gravity)

class SpriteBatch {
  constructor(max, tex, additive) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max * 2); this.col = new Float32Array(max * 4);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage)); // size, rotation
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogColor: { value: new THREE.Color(0xc9d3d8) }, fogNear: { value: 60 }, fogFar: { value: 260 } },
      vertexShader: `
        attribute vec3 iPos; attribute vec2 iSize; attribute vec4 iCol;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){
          vUv = uv; vCol = iCol;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iSize.y), s = sin(iSize.y);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize.x;
          vec4 mv = viewMatrix * vec4(iPos + right * p.x + up * p.y, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear, fogFar;
        varying vec2 vUv; varying vec4 vCol; varying float vDepth;
        void main(){
          vec4 t = texture2D(map, vUv);
          vec4 c = t * vCol;
          c.rgb = pow(c.rgb, vec3(2.2)); // authored in sRGB, the scene buffer is linear
          float f = smoothstep(fogNear, fogFar, vDepth);
          c.rgb = mix(c.rgb, fogColor, f * ${additive ? '0.0' : '1.0'});
          ${additive ? 'c.rgb *= c.a * (1.0 - f) * 3.5;' : ''}
          if (c.a < 0.004) discard;
          gl_FragColor = c;
        }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.geo = g; this.max = max; this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, rot, r, g, b, a) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.size[i * 2] = size; this.size[i * 2 + 1] = rot;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const k of ['iPos', 'iSize', 'iCol']) { const at = this.geo.attributes[k]; at.needsUpdate = true; at.updateRange.count = this.n * at.itemSize; }
  }
}

const FX = {
  scene: null, particles: [], tracers: [], smokes: [], fires: [], nades: [], decoys: [],
  init(scene) {
    this.scene = scene;
    FX_TEX.puff = puffTexture(); FX_TEX.flame = flameTexture(); FX_TEX.flash = flashTexture(); FX_TEX.decal = decalTexture();
    const spark = makeCanvas(32, 32), sg = spark.getContext('2d'), gr = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 32, 32);
    FX_TEX.spark = new THREE.CanvasTexture(spark);
    this.smokeBatch = new SpriteBatch(2400, FX_TEX.puff, false); scene.add(this.smokeBatch.mesh); this.smokeBatch.mesh.renderOrder = 5;
    this.dustBatch = new SpriteBatch(600, FX_TEX.puff, false); scene.add(this.dustBatch.mesh); this.dustBatch.mesh.renderOrder = 4;
    this.addBatch = new SpriteBatch(1200, FX_TEX.spark, true); scene.add(this.addBatch.mesh); this.addBatch.mesh.renderOrder = 6;
    this.fireBatch = new SpriteBatch(600, FX_TEX.flame, true); scene.add(this.fireBatch.mesh); this.fireBatch.mesh.renderOrder = 6;
    // bullet hole decals (instanced ring buffer)
    const dm = new THREE.MeshStandardMaterial({ map: FX_TEX.decal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.09), dm, 300); this.decals.count = 0; this.decalI = 0; scene.add(this.decals);
    const bm = new THREE.MeshStandardMaterial({ map: FX_TEX.puff, color: 0x6a0a06, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 1 });
    this.blood = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.7), bm, 80); this.blood.count = 0; this.bloodI = 0; scene.add(this.blood);
    // tracers: CPU-built ribbons
    this.tracerMax = 64;
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(this.tracerMax * 4 * 3); this.tracerAlpha = new Float32Array(this.tracerMax * 4);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('alpha', new THREE.BufferAttribute(this.tracerAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = []; for (let i = 0; i < this.tracerMax; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    tg.setIndex(idx);
    this.tracerMesh = new THREE.Mesh(tg, new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(3.0, 2.0, 0.9, 1.0) * vA; }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.tracerMesh.frustumCulled = false; scene.add(this.tracerMesh);
    // light pool (fixed count so shaders never recompile mid-game)
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffb060, 0, 12, 2); scene.add(l); this.lights.push({ l, t: 0, max: 0, power: 0 }); }
    initCasings(scene);
  },
  // spent case for agent `a` firing weapon `key`, thrown out after `delay` seconds
  queueCasing(a, key, delay) {
    if (!a.isPlayer && a !== CAM.view && dist3(a, SFX.listener) > 28) return; // nobody would see it
    CASINGS.queue.push({ a, key, t: delay || 0 });
  },
  reset() {
    for (const f of this.fires) f.stopSound();
    for (const n of this.nades) this.scene.remove(n.mesh);
    for (const d of this.decoys) if (d.mesh) this.scene.remove(d.mesh);
    this.particles.length = 0; this.tracers.length = 0; this.smokes.length = 0; this.fires.length = 0; this.nades.length = 0; this.decoys.length = 0;
    this.decals.count = 0; this.decalI = 0; this.blood.count = 0; this.bloodI = 0;
    CASINGS.list.length = 0; CASINGS.queue.length = 0;
    if (WORLD.fireBlocked) WORLD.fireBlocked.fill(0);
  },
  flashLight(x, y, z, color, power, dur, range) {
    let best = this.lights[0];
    for (const L of this.lights) if (L.t <= 0) { best = L; break; } else if (L.t < best.t) best = L;
    best.l.position.set(x, y, z); best.l.color.setHex(color); best.l.distance = range || 12; best.t = dur; best.max = dur; best.power = power;
  },
  // ---------- particles ----------
  spawn(p) { this.particles.push(p); if (this.particles.length > 900) this.particles.splice(0, this.particles.length - 900); },
  impact(x, y, z, n, surface) {
    // decal
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * TAU));
    m.compose(new THREE.Vector3(x + n[0] * 0.003, y + n[1] * 0.003, z + n[2] * 0.003), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.7 + Math.random() * 0.6));
    this.decals.setMatrixAt(this.decalI, m); this.decalI = (this.decalI + 1) % 300; this.decals.count = Math.max(this.decals.count, this.decalI === 0 ? 300 : this.decalI);
    this.decals.instanceMatrix.needsUpdate = true;
    // dust puff + chips / sparks
    const dustCol = surface === 'wood' ? [0.55, 0.42, 0.3] : surface === 'metal' ? [0.5, 0.5, 0.5] : [0.72, 0.69, 0.64];
    for (let i = 0; i < 3; i++) this.spawn({ kind: 'dust', x, y, z, vx: n[0] * rand(0.4, 1.4) + rand(-0.3, 0.3), vy: n[1] * rand(0.4, 1.4) + rand(0, 0.6), vz: n[2] * rand(0.4, 1.4) + rand(-0.3, 0.3), life: rand(0.5, 0.9), max: 0.9, size: rand(0.12, 0.25), grow: 0.6, col: dustCol, a: 0.6, g: -0.3 });
    if (surface === 'metal') for (let i = 0; i < 5; i++) this.spawn({ kind: 'spark', x, y, z, vx: n[0] * rand(1, 4) + rand(-2, 2), vy: n[1] * rand(1, 4) + rand(0, 2), vz: n[2] * rand(1, 4) + rand(-2, 2), life: rand(0.15, 0.35), max: 0.35, size: 0.04, col: [1, 0.8, 0.4], a: 1, g: 9 });
    else for (let i = 0; i < 3; i++) this.spawn({ kind: 'chip', x, y, z, vx: n[0] * rand(1, 3) + rand(-1, 1), vy: n[1] * rand(1, 3) + rand(0.5, 2), vz: n[2] * rand(1, 3) + rand(-1, 1), life: rand(0.3, 0.6), max: 0.6, size: 0.035, col: dustCol.map((c) => c * 0.6), a: 1, g: 9 });
  },
  bloodHit(x, y, z, dx, dy, dz, head) {
    for (let i = 0; i < (head ? 10 : 5); i++) this.spawn({ kind: 'blood', x, y, z, vx: dx * rand(1, 3) + rand(-0.8, 0.8), vy: dy * rand(1, 3) + rand(-0.2, 1.2), vz: dz * rand(1, 3) + rand(-0.8, 0.8), life: rand(0.3, 0.6), max: 0.6, size: rand(0.06, 0.14), grow: 1, col: [0.45, 0.02, 0.02], a: 0.9, g: 6 });
    // splatter on the wall behind
    const hit = rayCast(x, y, z, dx, dy - 0.15, dz, 2.5, false);
    if (hit) {
      const px = x + dx * hit.t, py = y + (dy - 0.15) * hit.t, pz = z + dz * hit.t, n = hit.n;
      const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * TAU));
      m.compose(new THREE.Vector3(px + n[0] * 0.004, py + n[1] * 0.004, pz + n[2] * 0.004), q, new THREE.Vector3(1, 1, 1).multiplyScalar(rand(0.5, 1.1)));
      this.blood.setMatrixAt(this.bloodI, m); this.bloodI = (this.bloodI + 1) % 80; this.blood.count = Math.max(this.blood.count, this.bloodI === 0 ? 80 : this.bloodI);
      this.blood.instanceMatrix.needsUpdate = true;
    }
  },
  tracer(x0, y0, z0, x1, y1, z1) {
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    if (L < 2) return;
    this.tracers.push({ x0, y0, z0, dx: (x1 - x0) / L, dy: (y1 - y0) / L, dz: (z1 - z0) / L, L, d: 0 });
    if (this.tracers.length > this.tracerMax) this.tracers.shift();
  },
  update(dt, camPos) {
    // lights
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.t / L.max) * L.power; } else L.l.intensity = 0; }
    // grenades in flight
    updateNades(dt);
    // particles
    this.dustBatch.begin(); this.addBatch.begin();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy -= (p.g || 0) * dt;
      const drag = p.kind === 'dust' || p.kind === 'smokepuff' ? Math.exp(-dt * 2.5) : 1;
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.01 && p.g > 0) { p.y = 0.01; p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; }
      const k = p.life / p.max, size = p.size * (1 + (1 - k) * (p.grow || 0));
      if (p.kind === 'spark' || p.kind === 'fireball' || p.kind === 'ember') this.addBatch.add(p.x, p.y, p.z, size, 0, p.col[0], p.col[1], p.col[2], p.a * k);
      else this.dustBatch.add(p.x, p.y, p.z, size, p.rot || 0, p.col[0], p.col[1], p.col[2], p.a * Math.min(1, k * 1.5));
    }
    // tracers
    const tp = this.tracerPos, ta = this.tracerAlpha;
    tp.fill(0); ta.fill(0);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.d += 420 * dt;
      if (t.d - 3 > t.L) { this.tracers.splice(i, 1); continue; }
    }
    this.tracers.forEach((t, i) => {
      const h = Math.min(t.d, t.L), tl = Math.max(0, t.d - 3.5);
      const hx = t.x0 + t.dx * h, hy = t.y0 + t.dy * h, hz = t.z0 + t.dz * h, sx = t.x0 + t.dx * tl, sy = t.y0 + t.dy * tl, sz = t.z0 + t.dz * tl;
      // ribbon width perpendicular to view
      const cx = camPos.x - hx, cy = camPos.y - hy, cz = camPos.z - hz;
      let px = t.dy * cz - t.dz * cy, py = t.dz * cx - t.dx * cz, pz = t.dx * cy - t.dy * cx;
      const pl = Math.hypot(px, py, pz) || 1, w = 0.012;
      px *= w / pl; py *= w / pl; pz *= w / pl;
      const o = i * 12;
      tp.set([sx - px, sy - py, sz - pz, sx + px, sy + py, sz + pz, hx + px, hy + py, hz + pz, hx - px, hy - py, hz - pz], o);
      ta.set([0, 0, 0.9, 0.9], i * 4);
    });
    this.tracerMesh.geometry.attributes.position.needsUpdate = true; this.tracerMesh.geometry.attributes.alpha.needsUpdate = true;
    updateCasings(dt);
    updateMuzzleSmoke(dt);
    // smoke + fire
    updateSmokes(dt, camPos);
    updateFires(dt);
    updateDecoys(dt);
    this.dustBatch.end(); this.addBatch.end();
  },
};

// ======================================================= GRENADE FLIGHT
function throwGrenade(owner, type, x, y, z, vx, vy, vz) {
  const info = gunModel(type);
  const mesh = info.group; mesh.scale.setScalar(1.2);
  FX.scene.add(mesh);
  FX.nades.push({ type, owner, x, y, z, vx, vy, vz, t: 0, mesh, rest: false, bounceT: 0, spin: rand(-12, 12) });
}
function nadeCollide(x, y, z) { return queryBoxes(x - 0.05, y - 0.05, z - 0.05, x + 0.05, y + 0.05, z + 0.05).length > 0; }
function updateNades(dt) {
  for (let i = FX.nades.length - 1; i >= 0; i--) {
    const n = FX.nades[i];
    n.t += dt;
    let landed = false;
    if (!n.rest) {
      const steps = 4, h = dt / steps;
      for (let s = 0; s < steps; s++) {
        n.vy -= GRAV_NADE * h;
        let nx = n.x + n.vx * h;
        if (nadeCollide(nx, n.y, n.z)) { n.vx = -n.vx * 0.45; n.vz *= 0.75; n.vy *= 0.85; bounce(n); } else n.x = nx;
        let nz = n.z + n.vz * h;
        if (nadeCollide(n.x, n.y, nz)) { n.vz = -n.vz * 0.45; n.vx *= 0.75; n.vy *= 0.85; bounce(n); } else n.z = nz;
        let ny = n.y + n.vy * h;
        if (nadeCollide(n.x, ny, n.z)) {
          if (n.vy < 0) landed = true;
          if (Math.abs(n.vy) > 1.5) bounce(n);
          n.vy = Math.abs(n.vy) > 1.2 ? -n.vy * 0.4 : 0; n.vx *= 0.65; n.vz *= 0.65;
        } else n.y = ny;
        if (n.y < -5) { n.y = -5; n.rest = true; }
      }
      if (n.vy === 0 && Math.hypot(n.vx, n.vz) < 0.15 && landed) n.rest = true;
    }
    n.mesh.position.set(n.x, n.y + 0.03, n.z);
    if (!n.rest) { n.mesh.rotation.x += n.spin * dt; n.mesh.rotation.z += n.spin * 0.6 * dt; }
    // molotovs burn in smoke and break on the ground
    const fire = n.type === 'molotov' || n.type === 'incgrenade';
    if (fire && smokeDensityAt(n.x, n.y, n.z) > 0.4) { SFX.play('fizzle', n); finishNade(i); continue; }
    let pop = false;
    if (n.type === 'he' || n.type === 'flash') pop = n.t >= 1.6;
    else if (fire) pop = landed && Math.abs(n.vy) < 3 && n.t > 0.1 || n.t >= 2.0;
    else if (n.type === 'smoke') pop = (n.rest && n.t > 0.6) || n.t > 4;
    else if (n.type === 'decoy') pop = n.rest || n.t > 4;
    if (pop) { detonate(n, landed); finishNade(i); }
  }
}
function bounce(n) { if (G.time - n.bounceT > 0.08) { SFX.play('bounce', n); n.bounceT = G.time; } }
function finishNade(i) { FX.scene.remove(FX.nades[i].mesh); FX.nades.splice(i, 1); }

function detonate(n, landed) {
  const { x, y, z } = n;
  if (n.type === 'he') {
    SFX.play('he', n);
    FX.flashLight(x, y + 0.5, z, 0xffa040, 30, 0.35, 14);
    for (let i = 0; i < 26; i++) FX.spawn({ kind: 'fireball', x: x + rand(-0.3, 0.3), y: y + rand(0, 0.5), z: z + rand(-0.3, 0.3), vx: rand(-4, 4), vy: rand(0, 4), vz: rand(-4, 4), life: rand(0.2, 0.45), max: 0.45, size: rand(0.6, 1.2), col: [1, 0.6, 0.25], a: 1, g: 0 });
    for (let i = 0; i < 14; i++) FX.spawn({ kind: 'smokepuff', x: x + rand(-0.5, 0.5), y: y + rand(0.2, 1.2), z: z + rand(-0.5, 0.5), vx: rand(-1.5, 1.5), vy: rand(0.4, 1.4), vz: rand(-1.5, 1.5), life: rand(1.6, 2.6), max: 2.6, size: rand(1, 1.6), grow: 1.2, col: [0.24, 0.23, 0.22], a: 0.75, rot: rand(0, TAU), g: 0 });
    for (const a of G.agents) {
      if (!a.alive) continue;
      const cy = a.y + 1.0, d = Math.hypot(a.x - x, cy - y, a.z - z);
      if (d > 11) continue;
      if (!losClear(x, y + 0.2, z, a.x, cy, a.z) && !losClear(x, y + 0.2, z, a.x, a.y + 0.3, a.z)) continue;
      const sigma = 8.9 / 3; let dmg = 98 * Math.exp(-(d * d) / (2 * sigma * sigma));
      if (!hostile(a, n.owner) && a !== n.owner) dmg *= 0.33; // reduced team damage (never applies in FFA)
      if (dmg >= 1) applyDamage(a, n.owner, 'he', dmg, 'chest', { x: a.x - x, y: 0, z: a.z - z, blast: true });
    }
    clearSmoke(x, y + 0.5, z, 3.2, 2.6);
    shakeCamera(Math.max(0, 1 - Math.hypot(x - CAM.pos.x, z - CAM.pos.z) / 16) * 0.7);
  } else if (n.type === 'flash') {
    SFX.play('flashbang', n);
    FX.flashLight(x, y + 0.2, z, 0xffffff, 60, 0.25, 22);
    for (let i = 0; i < 10; i++) FX.spawn({ kind: 'spark', x, y, z, vx: rand(-5, 5), vy: rand(-2, 5), vz: rand(-5, 5), life: rand(0.2, 0.5), max: 0.5, size: 0.06, col: [1, 1, 0.9], a: 1, g: 6 });
    for (const a of G.agents) {
      if (!a.alive || (a.flashImmuneT && G.time < a.flashImmuneT)) continue; // a bot that threw it looked away
      const ex = a.x, ey = a.y + a.eye, ez = a.z, d = Math.hypot(ex - x, ey - y, ez - z);
      if (d > 50) continue;
      if (!losClear(x, y + 0.05, z, ex, ey, ez) || smokeBlocks(x, y + 0.05, z, ex, ey, ez)) continue;
      const fd = dirFromAngles(a.yaw, a.pitch), dx = (x - ex) / d, dy = (y - ey) / d, dz = (z - ez) / d;
      const ang = Math.acos(clamp(fd.x * dx + fd.y * dy + fd.z * dz, -1, 1)) / DEG;
      const af = ang < 53 ? 1 : ang < 72 ? 0.8 : ang < 101 ? 0.5 : 0.25;
      const df = d < 6 ? 1 : clamp(1 - (d - 6) / 44, 0.12, 1);
      const blind = 4.9 * af * df;
      if (blind < 0.3) continue;
      blindAgent(a, blind, n.owner);
    }
  } else if (n.type === 'smoke') {
    SFX.play('smokepop', n);
    spawnSmoke(x, y, z);
  } else if (n.type === 'molotov' || n.type === 'incgrenade') {
    if (!landed) { SFX.play('fizzle', n); for (let i = 0; i < 12; i++) FX.spawn({ kind: 'fireball', x, y, z, vx: rand(-2, 2), vy: rand(-2, 1), vz: rand(-2, 2), life: 0.4, max: 0.4, size: 0.4, col: [1, 0.5, 0.15], a: 1, g: 3 }); return; }
    SFX.play(n.type === 'molotov' ? 'glass' : 'ignite', n); SFX.play('ignite', n);
    spawnFire(x, y, z, n.owner);
  } else if (n.type === 'decoy') {
    const mesh = gunModel('decoy').group; mesh.position.set(x, y + 0.03, z); FX.scene.add(mesh);
    FX.decoys.push({ x, y, z, owner: n.owner, t: 0, next: 0.4, sound: WEAPONS[n.owner.inv.primary || n.owner.inv.secondary || 'glock'].sound, mesh });
  }
  makeSound(n.owner, x, z, n.type === 'smoke' ? 25 : 45, 'nade');
}
function updateDecoys(dt) {
  for (let i = FX.decoys.length - 1; i >= 0; i--) {
    const d = FX.decoys[i];
    d.t += dt; d.next -= dt;
    if (d.next <= 0 && d.t < 15) {
      const burst = randInt(1, 4);
      for (let k = 0; k < burst; k++) setTimeout(() => { SFX.shot(d.sound, d); }, k * 110);
      makeSound(d.owner, d.x, d.z, 40, 'shot', true);
      d.next = rand(0.6, 2.2);
    }
    if (d.t >= 15.5) { SFX.play('he', d); FX.scene.remove(d.mesh); FX.decoys.splice(i, 1); }
  }
}

// ======================================================= VOLUMETRIC SMOKE
const VS = 0.7; // voxel size
const vkey = (ix, iy, iz) => ((ix + 512) * 1024 + (iz + 512)) * 64 + (iy + 8);
function spawnSmoke(x, y, z) {
  // Dijkstra flood fill through open space: the cloud takes the shape of the room it is in
  const sx = Math.floor(x / VS), sy = Math.floor((y + 0.4) / VS), sz = Math.floor(z / VS);
  const cap = 300, maxR = 7.5;
  const seen = new Set(), vox = [], map = new Map(), heap = new Heap();
  const free = (ix, iy, iz) => {
    const cx = (ix + 0.5) * VS, cy = (iy + 0.5) * VS, cz = (iz + 0.5) * VS;
    if (cy < 0 || cy > y + 3.6) return false;
    return queryBoxes(cx - 0.2, cy - 0.2, cz - 0.2, cx + 0.2, cy + 0.2, cz + 0.2).length === 0;
  };
  let start = [sx, sy, sz];
  if (!free(...start)) { for (const o of [[0, 1, 0], [0, 2, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) { const c = [sx + o[0], sy + o[1], sz + o[2]]; if (free(...c)) { start = c; break; } } }
  heap.push(0, start); seen.add(vkey(...start));
  while (heap.size && vox.length < cap) {
    const d = heap.k[0], c = heap.pop();
    const [ix, iy, iz] = c;
    if (d > maxR) break;
    const v = { ix, iy, iz, x: (ix + 0.5) * VS + rand(-0.2, 0.2), y: (iy + 0.5) * VS + rand(-0.15, 0.15), z: (iz + 0.5) * VS + rand(-0.2, 0.2), d, hole: 0, rot: rand(0, TAU), shade: rand(0.86, 1.04), size: rand(1.35, 1.75) };
    vox.push(v); map.set(vkey(ix, iy, iz), v);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      const n = [ix + dx, iy + dy, iz + dz], k = vkey(...n);
      if (seen.has(k)) continue; seen.add(k);
      if (!free(...n)) continue;
      // grow outward, a bit flatter than a sphere, and prefer to sit on the floor
      const ex = (n[0] - start[0]) * VS, ey = (n[1] - start[1]) * VS, ez = (n[2] - start[2]) * VS;
      heap.push(Math.hypot(ex, ey * 1.6, ez) + (dy > 0 ? 0.15 : 0) + Math.random() * 0.3, n);
    }
  }
  let r = 0; for (const v of vox) r = Math.max(r, Math.hypot(v.x - x, v.z - z));
  const sm = { x, y, z, t: 0, life: 19, vox, map, r: r + 1.2, cy: y + 1.4 };
  FX.smokes.push(sm);
  // smoke puts out fire
  for (const f of FX.fires) for (const c of f.cells) if (c.on && smokeDensityAt(c.x, c.y + 0.4, c.z) > 0.2) c.on = false;
}
function voxAlpha(sm, v) {
  const grow = clamp((sm.t * 6.5 - v.d) / 1.2, 0, 1);
  const fade = clamp((sm.life - sm.t) / 2.5, 0, 1);
  const hole = 1 - clamp(v.hole, 0, 1);
  return grow * fade * hole;
}
function smokeDensityAt(x, y, z) {
  let best = 0;
  for (const sm of FX.smokes) {
    if (Math.abs(x - sm.x) > sm.r || Math.abs(z - sm.z) > sm.r) continue;
    const ix = Math.floor(x / VS), iy = Math.floor(y / VS), iz = Math.floor(z / VS);
    const v = sm.map.get(vkey(ix, iy, iz));
    if (v) best = Math.max(best, voxAlpha(sm, v));
  }
  return best;
}
// does smoke block the view between two points?
function smokeBlocks(ax, ay, az, bx, by, bz) {
  if (!FX.smokes.length) return false;
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  for (const sm of FX.smokes) {
    // closest approach of the segment to the cloud center
    const t = clamp(((sm.x - ax) * dx + (sm.cy - ay) * dy + (sm.z - az) * dz) / (L * L), 0, 1);
    if (Math.hypot(ax + dx * t - sm.x, ay + dy * t - sm.cy, az + dz * t - sm.z) > sm.r + 1) continue;
    let acc = 0;
    const step = 0.35, n = Math.ceil(L / step);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const v = sm.map.get(vkey(Math.floor((ax + dx * k) / VS), Math.floor((ay + dy * k) / VS), Math.floor((az + dz * k) / VS)));
      if (v) { acc += voxAlpha(sm, v) * step; if (acc > 0.95) return true; }
    }
  }
  return false;
}
// a bullet passing through leaves a short-lived tunnel
function punchSmoke(ox, oy, oz, dx, dy, dz, L) {
  for (const sm of FX.smokes) {
    const t = clamp((sm.x - ox) * dx + (sm.cy - oy) * dy + (sm.z - oz) * dz, 0, L);
    if (Math.hypot(ox + dx * t - sm.x, oy + dy * t - sm.cy, oz + dz * t - sm.z) > sm.r + 1) continue;
    let hit = false;
    for (let s = 0; s <= L; s += 0.35) {
      const px = ox + dx * s, py = oy + dy * s, pz = oz + dz * s;
      const ix = Math.floor(px / VS), iy = Math.floor(py / VS), iz = Math.floor(pz / VS);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const v = sm.map.get(vkey(ix + a, iy + b, iz + c));
        if (!v) continue;
        const dd = Math.hypot(v.x - px, v.y - py, v.z - pz);
        if (dd < 0.55) { v.hole = Math.max(v.hole, 1.6 - dd); hit = true; }
      }
    }
    if (hit) sm.punched = true;
  }
}
function clearSmoke(x, y, z, radius, dur) {
  for (const sm of FX.smokes) for (const v of sm.vox) { const d = Math.hypot(v.x - x, v.y - y, v.z - z); if (d < radius) v.hole = Math.max(v.hole, dur * (1.2 - d / radius)); }
}
function updateSmokes(dt, cam) {
  const B = FX.smokeBatch;
  B.begin();
  const list = [];
  for (let i = FX.smokes.length - 1; i >= 0; i--) {
    const sm = FX.smokes[i];
    sm.t += dt;
    if (sm.t > sm.life) { FX.smokes.splice(i, 1); continue; }
    const indoor = isIndoors(sm.x, sm.z) ? 0.62 : 1;
    for (const v of sm.vox) {
      if (v.hole > 0) v.hole = Math.max(0, v.hole - dt * 1.1);
      const a = voxAlpha(sm, v);
      if (a < 0.02) continue;
      const dc = Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z);
      if (dc < 0.8) continue;
      v.rot += dt * 0.05;
      const lit = (0.68 + 0.22 * clamp((v.y - sm.y) / 3, 0, 1)) * v.shade * indoor;
      list.push([dc, v.x, v.y + Math.sin(sm.t * 0.4 + v.rot) * 0.04, v.z, v.size * (0.75 + 0.25 * clamp(sm.t, 0, 1)), v.rot, lit, a * 0.6]);
    }
  }
  list.sort((p, q) => q[0] - p[0]);
  for (const s of list) B.add(s[1], s[2], s[3], s[4], s[5], s[6], s[6], s[6] * 1.02, s[7]);
  B.end();
}

// ======================================================= FIRE
function spawnFire(x, y, z, owner) {
  const nav = WORLD.nav;
  if (!WORLD.fireBlocked) WORLD.fireBlocked = new Uint8Array(NAV_W * NAV_D);
  const start = nearestWalkable(x, z, y);
  if (start < 0) return;
  const h0 = nav.h[start];
  const cells = [], seen = new Set([start]), q = [[start, 0]];
  while (q.length && cells.length < 70) {
    const [i, d] = q.shift();
    const c = navCenter(i);
    if (smokeDensityAt(c.x, c.y + 0.4, c.z) > 0.3) continue;
    cells.push({ i, x: c.x, y: c.y, z: c.z, d, on: true, seed: Math.random() * 10 });
    const cx = i % NAV_W, cz = Math.floor(i / NAV_W);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = (cz + dz) * NAV_W + cx + dx;
      if (seen.has(ni) || cx + dx < 0 || cx + dx >= NAV_W || cz + dz < 0 || cz + dz >= NAV_D) continue;
      seen.add(ni);
      if (!nav.walk[ni]) continue;
      if (Math.abs(nav.h[ni] - h0) > 0.7) continue;
      const nc = navCenter(ni), nd = Math.hypot(nc.x - x, nc.z - z);
      if (nd > 3.3) continue;
      q.push([ni, nd]);
    }
  }
  const f = { x, y: h0, z, owner, t: 0, life: 7, cells, stopSound: SFX.fireLoop({ x, y: h0 + 0.5, z }), lightT: 0 };
  FX.fires.push(f);
}
function updateFires(dt) {
  const B = FX.fireBatch;
  B.begin();
  const fb = WORLD.fireBlocked;
  if (fb) fb.fill(0);
  for (let i = FX.fires.length - 1; i >= 0; i--) {
    const f = FX.fires[i];
    f.t += dt;
    let alive = 0;
    for (const c of f.cells) {
      if (!c.on) continue;
      if (f.t * 9 < c.d) continue; // spreading outward
      if (f.t > f.life - c.d * 0.1 || smokeDensityAt(c.x, c.y + 0.4, c.z) > 0.35) { c.on = false; continue; }
      alive++;
      if (fb) fb[c.i] = 1;
      const fl = 0.75 + 0.25 * Math.sin(G.time * 13 + c.seed * 7);
      B.add(c.x + Math.sin(c.seed) * 0.12, c.y + 0.3 * fl, c.z + Math.cos(c.seed) * 0.12, 0.65 * fl, Math.sin(G.time * 3 + c.seed) * 0.15, 1, 0.85, 0.6, 0.85);
      if (c.seed > 5) B.add(c.x - 0.1, c.y + 0.22, c.z + 0.1, 0.45 * (1.6 - fl), 0, 1, 0.7, 0.4, 0.7);
      if (Math.random() < dt * 0.8) FX.spawn({ kind: 'smokepuff', x: c.x, y: c.y + 0.6, z: c.z, vx: rand(-0.2, 0.2), vy: rand(0.8, 1.4), vz: rand(-0.2, 0.2), life: 1.6, max: 1.6, size: 0.5, grow: 1.5, col: [0.15, 0.14, 0.13], a: 0.4, rot: rand(0, TAU), g: 0 });
      if (Math.random() < dt * 1.5) FX.spawn({ kind: 'ember', x: c.x, y: c.y + 0.3, z: c.z, vx: rand(-0.5, 0.5), vy: rand(1, 2.5), vz: rand(-0.5, 0.5), life: 0.8, max: 0.8, size: 0.03, col: [1, 0.6, 0.2], a: 1, g: -0.5 });
    }
    f.lightT -= dt;
    if (alive && f.lightT <= 0) { FX.flashLight(f.x, f.y + 0.8, f.z, 0xff8a30, 6 + Math.random() * 3, 0.2, 9); f.lightT = 0.12; }
    // burn whoever stands in it
    if (alive) for (const a of G.agents) {
      if (!a.alive) continue;
      for (const c of f.cells) {
        if (!c.on || f.t * 9 < c.d) continue;
        if (Math.abs(a.x - c.x) < 0.45 && Math.abs(a.z - c.z) < 0.45 && a.y - c.y < 0.9 && a.y - c.y > -0.3) {
          a.burnAcc = (a.burnAcc || 0) + dt * 38;
          if (a.burnAcc >= 4) { applyDamage(a, f.owner, f.owner.team === 'T' ? 'molotov' : 'incgrenade', a.burnAcc, 'chest', { fire: true }); a.burnAcc = 0; }
          break;
        }
      }
    }
    if (f.t > 0.6 && !alive) { f.stopSound(); FX.fires.splice(i, 1); }
  }
  B.end();
}
function inFire(x, z) { const fb = WORLD.fireBlocked, i = navIndex(x, z); return !!(fb && i >= 0 && fb[i]); }

// ======================================================= SHELL CASINGS
// Pooled instanced brass and shotgun hulls with cheap point physics against the
// collision boxes: gravity, bounce, tumble, slide to rest, then shrink away.
const CASING_KINDS = {
  pistol: { r: 0.0048, len: 0.02, mesh: 'brass', life: 6 },
  rifle: { r: 0.0056, len: 0.042, mesh: 'brass', life: 7 },
  magnum: { r: 0.007, len: 0.062, mesh: 'brass', life: 8 },
  shell: { r: 0.0105, len: 0.062, mesh: 'hull', life: 8 },
};
const CASINGS = { list: [], queue: [], max: 140, brass: null, hull: null, lastTink: 0, dummy: null };
const CASING_G = 12; // a bit under the movement gravity so the arc reads at viewmodel scale
function initCasings(scene) {
  const brassGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const brass = new THREE.InstancedMesh(brassGeo, new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.2 }), CASINGS.max);
  // hulls: red plastic body with a brass head (vertex colours by height)
  const hullGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 5), hp = hullGeo.attributes.position, cols = [];
  for (let i = 0; i < hp.count; i++) { const head = hp.getY(i) < -0.25; cols.push(...(head ? [0.78, 0.6, 0.24] : [0.55, 0.06, 0.05])); }
  hullGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const hull = new THREE.InstancedMesh(hullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.5 }), CASINGS.max);
  for (const m of [brass, hull]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
  CASINGS.brass = brass; CASINGS.hull = hull; CASINGS.dummy = new THREE.Object3D();
}
const _cp = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _cf = new THREE.Vector3();
function spawnCasing(a, w) {
  const K = CASING_KINDS[w.casing]; if (!K) return;
  // the agent we look through throws brass from the viewmodel's ejection port
  const fromVM = a === CAM.view && VM.ejectWorld(_cp, _cr, _cu, _cf);
  if (!fromVM) {
    const m = muzzleWorld(a), f = dirFromAngles(a.yaw, a.pitch);
    _cf.set(f.x, f.y, f.z); _cr.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw)); _cu.crossVectors(_cr, _cf).normalize();
    _cp.set(m.x, m.y, m.z).addScaledVector(_cf, w.cat === 'pistol' ? -0.2 : -0.42).addScaledVector(_cu, 0.04);
  }
  const shell = w.casing === 'shell', side = rand(1.4, 2.3) * (shell ? 0.75 : 1);
  const c = {
    K, x: _cp.x, y: _cp.y, z: _cp.z,
    vx: _cr.x * side + _cu.x * rand(1.1, 1.9) + _cf.x * rand(-0.5, 0.05) + a.vx * 0.9,
    vy: _cr.y * side + _cu.y * rand(1.1, 1.9) + _cf.y * rand(-0.5, 0.05) + a.vy * 0.5,
    vz: _cr.z * side + _cu.z * rand(1.1, 1.9) + _cf.z * rand(-0.5, 0.05) + a.vz * 0.9,
    rx: rand(0, TAU), ry: a.yaw, rz: Math.PI / 2, wx: rand(-30, 30), wy: rand(-8, 8), wz: rand(-22, 22),
    life: K.life, bounced: false, ground: false, rest: false,
  };
  CASINGS.list.push(c);
  if (CASINGS.list.length > CASINGS.max) CASINGS.list.shift();
}
function casingTink(c, speed) {
  if (G.time - CASINGS.lastTink < 0.035 || dist3(c, SFX.listener) > 14) return; // a full spray shouldn't become noise
  CASINGS.lastTink = G.time;
  SFX.play('casing', { x: c.x, y: c.y, z: c.z }, { hull: c.K.mesh === 'hull', v: clamp(speed / 4, 0.3, 1) });
}
function updateCasings(dt) {
  const Q = CASINGS.queue;
  for (let i = Q.length - 1; i >= 0; i--) {
    const q = Q[i]; q.t -= dt;
    if (q.t > 0) continue;
    Q.splice(i, 1);
    if (q.a.alive && q.a.weaponKey === q.key) spawnCasing(q.a, WEAPONS[q.key]); // switched away mid-cycle: no case
  }
  const L = CASINGS.list;
  for (let i = L.length - 1; i >= 0; i--) {
    const c = L[i];
    c.life -= dt;
    if (c.life <= 0 || c.y < -8) { L.splice(i, 1); continue; }
    if (c.rest || dt <= 0) continue;
    if (c.ground) {
      // sliding / rolling on the floor
      const fr = Math.exp(-dt * 7); c.vx *= fr; c.vz *= fr; c.wx *= fr; c.wy *= fr;
      const nx = c.x + c.vx * dt; if (pointSolid(nx, c.y + 0.006, c.z)) c.vx *= -0.3; else c.x = nx;
      const nz = c.z + c.vz * dt; if (pointSolid(c.x, c.y + 0.006, nz)) c.vz *= -0.3; else c.z = nz;
      if (!pointSolid(c.x, c.y - 0.02, c.z)) { c.ground = false; continue; } // rolled off a ledge
      c.rx += c.wx * dt; c.ry += c.wy * dt;
      c.rz += (Math.PI / 2 - c.rz) * Math.min(1, dt * 12); // settle on its side
      if (Math.hypot(c.vx, c.vz) < 0.05) c.rest = true;
      continue;
    }
    c.vy -= CASING_G * dt;
    const nx = c.x + c.vx * dt; if (pointSolid(nx, c.y, c.z)) { c.vx *= -0.35; c.wy = -c.wy; } else c.x = nx;
    const nz = c.z + c.vz * dt; if (pointSolid(c.x, c.y, nz)) { c.vz *= -0.35; c.wy = -c.wy; } else c.z = nz;
    const ny = c.y + c.vy * dt;
    if (pointSolid(c.x, ny, c.z)) {
      const speed = Math.abs(c.vy);
      if (c.vy > 0) { c.vy = -c.vy * 0.2; continue; } // hit a ceiling
      if (!c.bounced || speed > 1.5) casingTink(c, speed);
      c.bounced = true;
      c.vy = speed * 0.3; c.vx *= 0.55; c.vz *= 0.55;
      c.wx = c.wx * 0.5 + rand(-10, 10); c.wz *= 0.4;
      if (c.vy < 0.45) { c.vy = 0; c.ground = true; }
    } else c.y = ny;
    c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
  }
  // write the instance matrices
  const d = CASINGS.dummy;
  let nb = 0, nh = 0;
  for (const c of L) {
    const K = c.K, fade = Math.min(1, c.life / 0.6); // shrink away at the end of its life
    d.position.set(c.x, c.y + (c.ground ? K.r : 0), c.z);
    d.rotation.set(c.rx, c.ry, c.rz, 'YXZ');
    d.scale.set(K.r * fade, K.len * fade, K.r * fade);
    d.updateMatrix();
    if (K.mesh === 'hull') CASINGS.hull.setMatrixAt(nh++, d.matrix); else CASINGS.brass.setMatrixAt(nb++, d.matrix);
  }
  CASINGS.brass.count = nb; CASINGS.hull.count = nh;
  if (nb) CASINGS.brass.instanceMatrix.needsUpdate = true;
  if (nh) CASINGS.hull.instanceMatrix.needsUpdate = true;
}

// ======================================================= MUZZLE SMOKE
// Thin wisps curling off a hot barrel: they build up with sustained fire (a.heat,
// added per shot in fireWeapon) and mostly show once the shooting stops.
const _mp = new THREE.Vector3();
function updateMuzzleSmoke(dt) {
  if (G.state !== 'playing' || dt <= 0) return;
  for (const a of G.agents) {
    if (!a.heat) continue;
    a.heat = Math.max(0, a.heat - dt * 0.38);
    if (!a.alive || a.heat < 0.35) continue;
    const since = G.time - a.lastShotT;
    if (since > 3) continue;
    const rate = (a.heat - 0.35) * 16 * (since < 0.15 ? 0.3 : 1);
    if (Math.random() > rate * dt) continue;
    let ok = a === CAM.view && VM.muzzleWorld(_mp);
    if (!ok) {
      if (dist3(a, SFX.listener) > 22) continue;
      const m = muzzleWorld(a); _mp.set(m.x, m.y, m.z); ok = true;
    }
    const w = WEAPONS[a.weaponKey], k = w && w.silenced ? 0.6 : 1;
    FX.spawn({ kind: 'smokepuff', x: _mp.x + rand(-0.01, 0.01), y: _mp.y, z: _mp.z + rand(-0.01, 0.01), vx: rand(-0.06, 0.06) + a.vx * 0.3, vy: rand(0.12, 0.3), vz: rand(-0.06, 0.06) + a.vz * 0.3,
      life: rand(1.1, 1.9), max: 1.9, size: rand(0.035, 0.06), grow: 3.2, col: [0.8, 0.8, 0.78], a: 0.17 * k, rot: rand(0, TAU), g: -0.22 });
  }
}
