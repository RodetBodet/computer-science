'use strict';
/* =====================================================================
   AUDIO: every sound is synthesized (filtered noise + oscillators) and
   placed in 3D with HRTF panning, so you can hear where shots and steps
   come from.
   ===================================================================== */
const SFX = {
  ctx: null, master: null, noise: null, volume: 0.6, listener: { x: 0, y: 0, z: 0 }, indoor: 0,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.15;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.dry = ctx.createGain(); this.dry.connect(this.master);
      // two rooms: open air (short slap-back off buildings) and the warehouse/tunnels (long, dense)
      this.revOut = ctx.createConvolver(); this.revOut.buffer = this.makeIR(1.6, 0.35, [0.045, 0.09, 0.14, 0.21], 0.5);
      this.revIn = ctx.createConvolver(); this.revIn.buffer = this.makeIR(2.4, 0.7, [0.012, 0.025, 0.04], 0.9);
      this.revOutG = ctx.createGain(); this.revInG = ctx.createGain(); this.revOutG.gain.value = 1; this.revInG.gain.value = 0;
      this.send = ctx.createGain();
      this.send.connect(this.revOut); this.send.connect(this.revIn);
      this.revOut.connect(this.revOutG); this.revIn.connect(this.revInG); this.revOutG.connect(this.master); this.revInG.connect(this.master);
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { this.ctx = null; }
    if (this.wantMusic) this.playMusic(this.wantMusic); // a track requested before audio was allowed starts now
  },
  // synthetic impulse response: exponential noise tail + discrete early echoes
  makeIR(seconds, decay, echoes, density) {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds), ir = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, env = Math.exp(-t / decay) * (t < 0.008 ? t / 0.008 : 1);
        lp += ((Math.random() * 2 - 1) - lp) * (0.25 + 0.6 * Math.exp(-t * 3)); // darker as it decays
        d[i] = lp * env * density;
      }
      for (const e of echoes) { const i = Math.floor((e + (ch ? 0.007 : 0)) * sr); for (let k = 0; k < 220 && i + k < n; k++) d[i + k] += (Math.random() * 2 - 1) * Math.exp(-k / 60) * 0.9 * Math.exp(-e * 4); }
    }
    return ir;
  },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; if (this.musicGain) this.musicGain.gain.value = v * 0.35; },
  // background music: one looping track at a time, crossfaded, kept below the sound effects
  playMusic(name) {
    this.wantMusic = name;
    if (!this.ctx || !ASSETS.music[name]) return;
    if (this.curMusic === name) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.musicGain) { this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.volume * 0.35; this.musicGain.connect(this.master); }
    if (this.musicSrc) { const old = this.musicSrc, og = this.musicFade; og.gain.setTargetAtTime(0, t, 0.6); old.stop(t + 2.5); }
    const src = ctx.createBufferSource(); src.buffer = ASSETS.music[name]; src.loop = true;
    const fade = ctx.createGain(); fade.gain.setValueAtTime(0, t); fade.gain.setTargetAtTime(1, t, 0.8);
    src.connect(fade); fade.connect(this.musicGain); src.start(t);
    this.musicSrc = src; this.musicFade = fade; this.curMusic = name;
  },
  // looping background beds: wind outside, water by the quay, a low hum indoors
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const ctx = this.ctx, loop = (freq, q, type) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.5;
      const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { f, g };
    };
    const wind = loop(420, 0.4), water = loop(700, 1.2, 'bandpass'), hum = loop(110, 6, 'bandpass');
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.07; lfoG.gain.value = 180; lfo.connect(lfoG); lfoG.connect(wind.f.frequency); lfo.start();
    const lfo2 = ctx.createOscillator(), lfo2G = ctx.createGain(); lfo2.frequency.value = 0.35; lfo2G.gain.value = 260; lfo2.connect(lfo2G); lfo2G.connect(water.f.frequency); lfo2.start();
    this.amb = { wind, water, hum };
  },
  updateAmbience(x, z, active) {
    if (!this.amb) return;
    const t = this.ctx.currentTime, indoor = this.indoor, nearWater = clamp(1 - (76 - x) / 14, 0, 1);
    this.amb.wind.g.gain.setTargetAtTime(active ? (indoor ? 0.012 : 0.05) : 0, t, 0.5);
    this.amb.water.g.gain.setTargetAtTime(active ? nearWater * 0.06 * (indoor ? 0.2 : 1) : 0, t, 0.5);
    this.amb.hum.g.gain.setTargetAtTime(active && indoor ? 0.03 : 0, t, 0.5);
  },
  setListener(x, y, z, yaw) {
    this.listener = { x, y, z };
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    // blend the reverb toward the room you're standing in
    const indoor = typeof isIndoors === 'function' && isIndoors(x, z) ? 1 : 0;
    if (indoor !== this.indoor) {
      this.indoor = indoor;
      this.revInG.gain.setTargetAtTime(indoor ? 1.1 : 0, t, 0.25); this.revOutG.gain.setTargetAtTime(indoor ? 0.2 : 1, t, 0.25);
    }
  },
  // output chain: gain -> air/occlusion filter -> 3D panner -> dry + reverb send
  out(pos, vol = 1, ref = 2.5) {
    const ctx = this.ctx, g = ctx.createGain();
    let tail = g;
    if (pos) {
      const d = this.dist(pos);
      const L = this.listener;
      const blocked = d > 1.5 && typeof losClear === 'function' && !losClear(L.x, L.y, L.z, pos.x, pos.y + 0.2, pos.z);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.value = Math.min(20000, 19000 / (1 + d * 0.022)) * (blocked ? 0.09 : 1); f.Q.value = 0.5;
      g.gain.value = vol * (blocked ? 0.55 : 1);
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = ref >= 6 ? 0.7 : 1.1; p.maxDistance = 250; // gunfire carries further
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(f); f.connect(p); tail = p;
      const s = ctx.createGain(); s.gain.value = clamp(0.08 + d / 110, 0.08, 0.42) * (blocked ? 1.25 : 1); p.connect(s); s.connect(this.send);
    } else {
      g.gain.value = vol;
      const s = ctx.createGain(); s.gain.value = 0.09; g.connect(s); s.connect(this.send);
    }
    tail.connect(this.dry);
    return g;
  },
  // recorded sample (returns false if that sound isn't loaded)
  sample(name, pos, vol = 1, rate = 1, ref = 2.5, delay = 0) {
    const buf = ASSETS.sounds[name];
    if (!this.ctx || !buf) return false;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06);
    src.connect(this.out(pos, vol, ref));
    src.start(this.ctx.currentTime + delay);
    return true;
  },
  reload(w, pos) {
    if (w.cat === 'heavy' && w.key !== 'mag7') return false;
    const name = w.cat === 'pistol' ? 'reload_pistol' : 'reload_rifle';
    // start late enough that the "mag in" click lands as the animation seats the magazine
    const buf = ASSETS.sounds[name]; if (!buf) return false;
    return this.sample(name, pos, pos ? 0.55 : 0.3, 1, 2.5, clamp(w.reload * 0.78 - buf.duration, 0, 2));
  },
  dist(pos) { return pos ? Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z) : 0; },
  noiseBurst(out, t, dur, type, freq, q, gain, sweepTo, rate) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rate || 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (q) f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  },
  tone(out, t, dur, type, f0, f1, gain, attack) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0008, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  },
  GUNS: {
    pistol: { lp: 4200, dur: 0.22, thump: 180, tg: 0.5, crack: 0.55 },
    silenced: { lp: 1600, dur: 0.12, thump: 140, tg: 0.25, crack: 0.12 },
    deagle: { lp: 2400, dur: 0.5, thump: 100, tg: 1.0, crack: 0.7 },
    smg: { lp: 4600, dur: 0.16, thump: 165, tg: 0.4, crack: 0.45 },
    rifle_t: { lp: 2700, dur: 0.32, thump: 115, tg: 0.85, crack: 0.65 },
    rifle_ct: { lp: 3600, dur: 0.27, thump: 135, tg: 0.7, crack: 0.6 },
    silenced_rifle: { lp: 1900, dur: 0.15, thump: 120, tg: 0.35, crack: 0.15 },
    shotgun: { lp: 1900, dur: 0.6, thump: 80, tg: 1.1, crack: 0.8 },
    scout: { lp: 2600, dur: 0.65, thump: 95, tg: 0.95, crack: 0.9 },
    awp: { lp: 1700, dur: 1.1, thump: 65, tg: 1.3, crack: 1.0 },
    taser: { lp: 6000, dur: 0.3, thump: 400, tg: 0.2, crack: 0.9 },
  },
  shot(kind, pos) {
    if (!this.ctx) return;
    const d = this.dist(pos);
    if (d > 180) return;
    const near = ASSETS.sounds[kind];
    if (near) {
      const fam = kind.startsWith('silenced') ? null : ['rifle_t', 'rifle_ct', 'pistol', 'awp', 'shotgun', 'smg'].includes(kind) ? kind : kind === 'deagle' ? 'pistol' : kind === 'scout' ? 'awp' : 'rifle_t';
      const far = fam && ASSETS.sounds[fam + '_far'];
      // crossfade close -> distant recording between 20 and 55 m
      const k = far ? smoothstep(20, 55, d) : 0;
      const sil = kind.startsWith('silenced'), ref = sil ? 3 : 9;
      const v = sil ? 0.4 : 1; // suppressed shots are far quieter
      if (k < 0.98) this.sample(kind, pos, (pos ? 1.2 : 0.95) * v * (1 - k), 1, ref);
      if (k > 0.02) this.sample(fam + '_far', pos, 0.95 * k, 1, ref);
      if (!pos && !kind.startsWith('silenced')) { const o = this.out(null, 0.5), t = this.ctx.currentTime; this.tone(o, t, 0.12, 'sine', 70, 38, 0.9); } // chest-thump for your own shots
      return;
    }
    const P = this.GUNS[kind] || this.GUNS.pistol, t = this.ctx.currentTime;
    const out = this.out(pos, pos ? 1.6 : 0.9);
    const lp = P.lp / (1 + d * 0.035);
    this.noiseBurst(out, t, P.dur, 'lowpass', lp, 0.7, 0.9, Math.max(60, lp * 0.3));
    this.noiseBurst(out, t, 0.035, 'highpass', 2600, 0, P.crack * (d > 25 ? 0.35 : 1));
    this.tone(out, t, P.dur * 0.5, 'sine', P.thump, 38, P.tg);
    if (d > 15) this.noiseBurst(out, t + 0.04 + d * 0.002, P.dur * 2.4, 'lowpass', 500, 0, 0.35); // echo off buildings
  },
  play(name, pos, opt) {
    if (!this.ctx) return;
    const d = this.dist(pos);
    if (d > 120) return;
    if (name === 'step') {
      const set = opt === 'metal' ? 'metal' : 'step', n = 1 + Math.floor(Math.random() * 4);
      // all clips are peak-normalized, so levels are set here: steps sit well under gunfire
      if (this.sample(set + n, pos, (pos ? 0.55 : 0.13) * (opt === 'metal' ? 0.9 : 1.2), opt === 'wood' ? 0.85 : 1)) return;
    }
    const alias = { pump: 'pump', bolt: 'bolt', empty: 'dryfire' }[name];
    if (alias && this.sample(alias, pos, pos ? 0.6 : 0.32)) return;
    const t = this.ctx.currentTime, o = this.out(pos, pos ? 1.4 : 0.8);
    switch (name) {
      case 'step': {
        const surf = opt || 'concrete';
        if (surf === 'metal') { this.noiseBurst(o, t, 0.09, 'bandpass', 1400 + Math.random() * 500, 3, 0.55); this.tone(o, t, 0.08, 'triangle', 420 + Math.random() * 120, 0, 0.12); }
        else if (surf === 'wood') this.noiseBurst(o, t, 0.08, 'bandpass', 600 + Math.random() * 200, 2, 0.6);
        else this.noiseBurst(o, t, 0.07, 'bandpass', 900 + Math.random() * 400, 1.6, 0.5);
        break;
      }
      case 'land': this.noiseBurst(o, t, 0.12, 'lowpass', 700, 0, 0.8); break;
      case 'knife': this.noiseBurst(o, t, 0.16, 'bandpass', 1800, 1.2, 0.5, 6000); break;
      case 'knifehit': this.noiseBurst(o, t, 0.1, 'lowpass', 900, 0, 0.8); this.tone(o, t, 0.08, 'sine', 180, 80, 0.5); break;
      case 'hit': this.noiseBurst(o, t, 0.06, 'lowpass', 1000, 0, 0.7); this.tone(o, t, 0.06, 'sine', 230, 90, 0.4); break;
      case 'headshot': this.tone(o, t, 0.2, 'sine', 2700, 2600, 0.28); this.tone(o, t, 0.14, 'sine', 4050, 3950, 0.12); this.noiseBurst(o, t, 0.05, 'highpass', 3000, 0, 0.35); break;
      case 'helmet': this.tone(o, t, 0.25, 'triangle', 3300, 3100, 0.25); this.tone(o, t, 0.2, 'sine', 5200, 5000, 0.12); break;
      case 'armor': this.noiseBurst(o, t, 0.05, 'highpass', 2200, 0, 0.4); break;
      case 'hurt': this.noiseBurst(o, t, 0.12, 'lowpass', 500, 0, 0.9); this.tone(o, t, 0.12, 'sine', 120, 60, 0.6); break;
      case 'impact': this.noiseBurst(o, t, 0.05, opt === 'metal' ? 'bandpass' : 'highpass', opt === 'metal' ? 3200 : 1800, opt === 'metal' ? 6 : 0, 0.35); break;
      case 'whizz': this.noiseBurst(o, t, 0.12, 'bandpass', 2500, 4, 0.35, 900); break;
      case 'clipout': this.tone(o, t, 0.03, 'square', 650, 0, 0.12); this.noiseBurst(o, t, 0.06, 'bandpass', 1500, 2, 0.45); break;
      case 'clipin': this.tone(o, t, 0.03, 'square', 1050, 0, 0.12); this.noiseBurst(o, t, 0.07, 'bandpass', 2300, 2, 0.55); break;
      case 'bolt': this.noiseBurst(o, t, 0.06, 'bandpass', 2800, 3, 0.5); this.noiseBurst(o, t + 0.12, 0.06, 'bandpass', 2000, 3, 0.5); break;
      case 'pump': this.noiseBurst(o, t, 0.08, 'bandpass', 1400, 2, 0.6); this.noiseBurst(o, t + 0.14, 0.08, 'bandpass', 1800, 2, 0.6); break;
      case 'empty': this.tone(o, t, 0.02, 'square', 1500, 0, 0.12); break;
      case 'deploy': this.noiseBurst(o, t, 0.1, 'bandpass', 1100, 2, 0.35); break;
      case 'zoom': this.noiseBurst(o, t, 0.05, 'bandpass', 3500, 4, 0.25); break;
      case 'buy': this.tone(o, t, 0.06, 'triangle', 880, 0, 0.18); this.tone(o, t + 0.06, 0.08, 'triangle', 1320, 0, 0.18); break;
      case 'deny': this.tone(o, t, 0.12, 'square', 170, 0, 0.12); break;
      case 'pickup': this.noiseBurst(o, t, 0.1, 'bandpass', 1300, 2, 0.4); this.tone(o, t + 0.05, 0.04, 'square', 900, 0, 0.08); break;
      case 'pin': this.tone(o, t, 0.05, 'square', 2400, 0, 0.06); this.noiseBurst(o, t + 0.05, 0.05, 'bandpass', 3000, 3, 0.25); break;
      case 'throw': this.noiseBurst(o, t, 0.2, 'bandpass', 700, 1, 0.35, 2400); break;
      case 'bounce': this.tone(o, t, 0.05, 'triangle', 1200 + Math.random() * 500, 0, 0.15); break;
      case 'he': this.noiseBurst(o, t, 1.3, 'lowpass', 1500, 0, 1.6, 110); this.tone(o, t, 0.9, 'sine', 85, 28, 1.2); this.noiseBurst(o, t, 0.14, 'highpass', 1400, 0, 0.8); break;
      case 'flashbang': this.noiseBurst(o, t, 0.4, 'highpass', 1700, 0, 1.4); this.tone(o, t, 0.25, 'sine', 160, 55, 0.8); break;
      case 'ring': { const r = this.out(null, 1); this.tone(r, t, opt || 3, 'sine', 3300, 3150, 0.14, 0.05); break; }
      case 'smokepop': this.noiseBurst(o, t, 0.3, 'lowpass', 600, 0, 0.6); this.noiseBurst(o, t, 3.2, 'bandpass', 1100, 0.5, 0.45, 280); break;
      case 'glass': this.noiseBurst(o, t, 0.25, 'highpass', 3500, 0, 0.9); this.tone(o, t, 0.15, 'triangle', 2800, 1900, 0.2); break;
      case 'ignite': this.noiseBurst(o, t, 0.8, 'lowpass', 1200, 0, 1.2, 300); break;
      case 'fizzle': this.noiseBurst(o, t, 0.9, 'highpass', 2500, 0, 0.5, 6000); break;
      case 'beep': this.tone(o, t, 0.1, 'sine', 2050, 2000, 0.35); break;
      case 'plantkey': this.tone(o, t, 0.05, 'square', 900 + Math.random() * 600, 0, 0.08); break;
      case 'planted': [880, 880, 1320].forEach((f, i) => this.tone(this.out(null), t + i * 0.15, 0.1, 'square', f, 0, 0.12)); break;
      case 'defuse': this.noiseBurst(o, t, 0.04, 'bandpass', 3000, 3, 0.3); break;
      case 'defused': [1320, 990, 660].forEach((f, i) => this.tone(this.out(null), t + i * 0.12, 0.12, 'triangle', f, 0, 0.18)); break;
      case 'explode':
        this.noiseBurst(o, t, 3.2, 'lowpass', 900, 0, 2.0, 70); this.tone(o, t, 2.2, 'sine', 65, 22, 1.5);
        this.noiseBurst(this.out(null, 0.8), t, 2.8, 'lowpass', 300, 0, 1.0, 40); break;
      case 'go': this.tone(o, t, 0.1, 'square', 660, 0, 0.1); this.tone(o, t + 0.13, 0.16, 'square', 990, 0, 0.1); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.11, 0.4, 'triangle', f, 0, 0.22)); break;
      case 'lose': [440, 370, 311, 247].forEach((f, i) => this.tone(o, t + i * 0.13, 0.4, 'triangle', f, 0, 0.2)); break;
      case 'tick': this.tone(o, t, 0.03, 'square', 1800, 0, 0.05); break;
      case 'taserhit': this.noiseBurst(o, t, 0.5, 'highpass', 3000, 0, 0.6); break;
      case 'death': this.noiseBurst(o, t, 0.25, 'lowpass', 400, 0, 0.5); break;
    }
  },
  // looping fire crackle; returns a stop() function
  fireLoop(pos) {
    if (!this.ctx) return () => {};
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 800; f.Q.value = 0.6;
    const g = this.out(pos, 0.5); s.connect(f); f.connect(g); s.start();
    return () => { try { g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2); s.stop(this.ctx.currentTime + 0.8); } catch (e) { /* already stopped */ } };
  },
};
