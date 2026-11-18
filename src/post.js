'use strict';
/* =====================================================================
   POST-PROCESSING: the scene is rendered into a floating-point buffer,
   then bloom + filmic tonemapping + grading + vignette are applied in a
   final full-screen pass.
   ===================================================================== */
const POST = { rt: null, bloom: [], quad: null, scene: null, cam: null, mats: {}, exposure: 1.0 };
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
function initPost(renderer) {
  const samples = renderer.capabilities.isWebGL2 && G.quality > 0 ? 4 : 0;
  const opt = { type: THREE.HalfFloatType, depthBuffer: true };
  POST.rt = new THREE.WebGLRenderTarget(4, 4, Object.assign({ samples }, opt));
  for (let i = 0; i < 4; i++) POST.bloom.push(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
  POST.scene = new THREE.Scene(); POST.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  POST.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); POST.quad.frustumCulled = false; POST.scene.add(POST.quad);
  const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  // bright pass with a soft knee
  POST.mats.bright = mk(`
    uniform sampler2D tSrc; uniform float threshold; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tSrc, vUv).rgb; float l = max(c.r, max(c.g, c.b));
      float k = clamp((l - threshold) / (l + 0.0001), 0.0, 1.0); gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0); }`,
  { tSrc: { value: null }, threshold: { value: 1.6 } });
  // 13-tap downsample (smooth, no flicker)
  POST.mats.down = mk(`
    uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
    vec3 s(vec2 o){ return texture2D(tSrc, vUv + o * texel).rgb; }
    void main(){
      vec3 c = s(vec2(0.0)) * 0.125;
      c += (s(vec2(-1.0,-1.0)) + s(vec2(1.0,-1.0)) + s(vec2(-1.0,1.0)) + s(vec2(1.0,1.0))) * 0.125;
      c += (s(vec2(-2.0,0.0)) + s(vec2(2.0,0.0)) + s(vec2(0.0,-2.0)) + s(vec2(0.0,2.0))) * 0.0625;
      c += (s(vec2(-2.0,-2.0)) + s(vec2(2.0,-2.0)) + s(vec2(-2.0,2.0)) + s(vec2(2.0,2.0))) * 0.03125;
      gl_FragColor = vec4(c, 1.0); }`,
  { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  POST.mats.comp = mk(`
    uniform sampler2D tScene, tB0, tB1, tB2, tB3; uniform vec2 texel; uniform float exposure, bloomStr, time, vignette;
    varying vec2 vUv;
    vec3 aces(vec3 x){ // ACES filmic fit
      x = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777) * x;
      vec3 a = x * (x + 0.0245786) - 0.000090537, b = x * (0.983729 * x + 0.4329510) + 0.238081;
      return clamp(mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602) * (a / b), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c)); }
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tScene, vUv).rgb;
      vec3 n = texture2D(tScene, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tScene, vUv - vec2(texel.x, 0.0)).rgb + texture2D(tScene, vUv + vec2(0.0, texel.y)).rgb + texture2D(tScene, vUv - vec2(0.0, texel.y)).rgb;
      c = max(c + (c - n * 0.25) * 0.28, 0.0); // light sharpening
      vec3 bloom = texture2D(tB0, vUv).rgb * 0.35 + texture2D(tB1, vUv).rgb * 0.45 + texture2D(tB2, vUv).rgb * 0.6 + texture2D(tB3, vUv).rgb * 0.8;
      c += bloom * bloomStr;
      c = aces(c * exposure);
      // grade: a touch more contrast and saturation, warm highlights, cooler shadows
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.0);
      c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), smoothstep(0.15, 0.75, l));
      c = clamp((c - 0.45) * 1.03 + 0.45, 0.0, 1.0);
      vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * vignette;
      c = toSRGB(c);
      c += (rnd(vUv * 731.0) - 0.5) / 255.0; // dither against banding
      gl_FragColor = vec4(c, 1.0); }`,
  { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, texel: { value: new THREE.Vector2() }, exposure: { value: 1 }, bloomStr: { value: 0.22 }, time: { value: 0 }, vignette: { value: 0.55 } });
}
function resizePost(renderer) {
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  POST.rt.setSize(v.x, v.y);
  let w = v.x, h = v.y;
  for (const b of POST.bloom) { w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); b.setSize(w, h); }
  POST.mats.comp.uniforms.texel.value.set(1 / v.x, 1 / v.y);
}
function pass(renderer, mat, target) { POST.quad.material = mat; renderer.setRenderTarget(target); renderer.render(POST.scene, POST.cam); }
function renderPost(renderer, drawScene) {
  renderer.setRenderTarget(POST.rt);
  renderer.clear();
  drawScene();
  const M = POST.mats;
  M.bright.uniforms.tSrc.value = POST.rt.texture; pass(renderer, M.bright, POST.bloom[0]);
  for (let i = 1; i < 4; i++) {
    const src = POST.bloom[i - 1];
    M.down.uniforms.tSrc.value = src.texture; M.down.uniforms.texel.value.set(1 / src.width, 1 / src.height);
    pass(renderer, M.down, POST.bloom[i]);
  }
  const u = M.comp.uniforms;
  u.tScene.value = POST.rt.texture; u.tB0.value = POST.bloom[0].texture; u.tB1.value = POST.bloom[1].texture; u.tB2.value = POST.bloom[2].texture; u.tB3.value = POST.bloom[3].texture;
  u.exposure.value = POST.exposure; u.time.value = (performance.now() % 10000) / 1000;
  pass(renderer, M.comp, null);
}
