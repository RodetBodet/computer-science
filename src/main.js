'use strict';
/* =====================================================================
   MAIN: renderer, lighting, sky and the game loop (64 ticks per second).
   ===================================================================== */
const TICK = 1 / 64;
const RENDER = { renderer: null, scene: null, camera: null, sun: null, canvas: null, captureAfterimage: false };

function buildSky(scene) {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3(-0.45, 0.72, 0.52).normalize() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizon = vec3(0.80, 0.84, 0.86), zenith = vec3(0.30, 0.50, 0.78), ground = vec3(0.55, 0.57, 0.58);
        vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, -h * 4.0);
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 6.0 + pow(s, 18.0) * 0.25);
        // a few soft cloud bands
        float c = sin(vDir.x * 9.0 + vDir.z * 5.0) * sin(vDir.z * 7.0 - vDir.x * 3.0);
        col = mix(col, vec3(0.95), smoothstep(0.55, 0.95, c) * smoothstep(0.05, 0.35, h) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat); sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}
function applyQuality() {
  const r = RENDER.renderer; if (!r) return;
  const q = G.quality, dpr = window.devicePixelRatio || 1;
  r.setPixelRatio(q === 0 ? Math.min(dpr, 1) * 0.75 : q === 1 ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
  const size = q === 0 ? 1024 : q === 1 ? 2048 : 4096;
  const sh = RENDER.sun.shadow;
  if (sh.mapSize.x !== size) { sh.mapSize.set(size, size); if (sh.map) { sh.map.dispose(); sh.map = null; } }
  r.shadowMap.enabled = true;
  r.setSize(innerWidth, innerHeight);
  if (POST.rt) resizePost(r);
}
function onResize() {
  const { renderer, camera } = RENDER;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (POST.rt) resizePost(renderer);
  VM.cam.aspect = innerWidth / innerHeight; VM.cam.updateProjectionMatrix();
  const f = $('flashimg'); f.width = Math.round(innerWidth / 2); f.height = Math.round(innerHeight / 2);
}

async function init() {
  if (typeof THREE === 'undefined') { $('load-msg').textContent = 'Could not load Three.js (the 3D library comes from the internet). Check your connection and reload.'; return; }
  loadSettings();
  $('load-msg').textContent = 'Loading textures and sky…';
  const soundsP = loadSounds();
  const hd = await loadAssets((f) => { $('load-msg').textContent = `Loading textures and sky… ${Math.round(f * 100)}%`; });
  if (!hd) $('load-msg').textContent = 'Using generated textures (open the game through a local web server for the full-quality assets)';
  else await loadGLTFModels((f) => { $('load-msg').textContent = `Loading weapons and characters… ${Math.round(f * 100)}%`; });
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // tonemapping happens in the post-processing pass
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  $('view').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9c6cf, 90, 420);
  const camera = new THREE.PerspectiveCamera(fov43(90), innerWidth / innerHeight, 0.05, 2000);
  camera.rotation.order = 'YXZ';
  const hemi = new THREE.HemisphereLight(0xd6e4ff, 0x8a7a64, hd ? 0.55 : 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d6, hd ? 3.6 : 2.8);
  const center = new THREE.Vector3(MAP_W / 2, 0, MAP_D / 2);
  let sd = hd && ASSETS.sunDir ? ASSETS.sunDir.clone() : new THREE.Vector3(-45, 72, 52).normalize();
  if (sd.y < 0.55) { sd.y = 0.55; sd.normalize(); } // keep shadows playable even if the photo's sun is low
  sun.position.copy(center).addScaledVector(sd, 110); sun.target.position.copy(center);
  sun.castShadow = true;
  const sc = sun.shadow.camera; sc.left = -62; sc.right = 62; sc.top = 62; sc.bottom = -62; sc.near = 20; sc.far = 240;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  Object.assign(RENDER, { renderer, scene, camera, sun, canvas: renderer.domElement });
  const pm = new THREE.PMREMGenerator(renderer);
  let env;
  if (hd) {
    scene.background = ASSETS.sky;
    env = pm.fromEquirectangular(ASSETS.sky).texture;
  } else {
    const sky = buildSky(scene), envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 16), new THREE.MeshBasicMaterial({ color: 0x6b6458 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
    env = pm.fromScene(envScene, 0.04, 0.1, 1000).texture;
  }
  scene.environment = env; RENDER.env = env;
  buildMaterials();
  FX.init(scene);
  buildWorld(scene);
  buildRadarBg();
  VM.init(); VM.scene.environment = env;
  initPost(renderer);
  applyQuality();
  onResize();
  window.addEventListener('resize', onResize);
  initInput();
  loadProgress();
  initMenus();
  G.bomb = null; resetBomb();
  await soundsP;
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
}
// switch the active map: rebuild geometry, collision, nav and radar
function loadMap(id) {
  loadMapDef(id);
  buildWorld(RENDER.scene);
  buildRadarBg();
  RENDER.scene.fog.color.setHex(MAP_INFO.theme.fog);
}

let lastT = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  const running = G.state === 'playing' && !G.paused;
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= TICK && n < 8) { G.time += TICK; updateGame(TICK); acc -= TICK; n++; }
    if (n === 8) acc = 0;
  } else if (G.state === 'menu') G.menuT += dt;
  const { renderer, scene, camera } = RENDER;
  updateCamera(dt, camera);
  if (G.state !== 'menu') for (const a of G.agents) if (a.model) a.model.update(a, running ? dt : 0);
  FX.update(running ? dt : 0, CAM.pos.lengthSq() ? CAM.pos : camera.position);
  VM.update(dt, CAM.view);
  if (WORLD.water && WORLD.water.material.normalMap) { const o = WORLD.water.material.normalMap.offset; o.x = (o.x + dt * 0.004) % 1; o.y = (o.y + dt * 0.0025) % 1; }
  renderPost(renderer, () => {
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(VM.scene, VM.cam);
  });
  if (RENDER.captureAfterimage) {
    RENDER.captureAfterimage = false;
    const f = $('flashimg'); f.getContext('2d').drawImage(renderer.domElement, 0, 0, f.width, f.height);
  }
  updateHUD(dt);
}

window.__sp = { G, WORLD, FX, CAM, VM, RENDER, POST, ASSETS, updateGame, startMatch, startRound, findPath, mouse, keys };
init();
