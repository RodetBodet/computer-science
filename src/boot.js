// Loads Three.js + its glTF loader as modules, exposes them as globals,
// then loads the game scripts in order (they share globals).
import * as THREE_NS from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

window.THREE = THREE_NS;
window.GLTFLoader = GLTFLoader;
window.SkeletonUtils = SkeletonUtils;

const files = ['util', 'assets', 'post', 'maps', 'map', 'textures', 'world', 'weapons', 'effects', 'models', 'gltfmodels', 'cosmetics', 'progression', 'audio', 'game', 'bots', 'player', 'hud', 'comms', 'lobby', 'main'];
for (const f of files) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `src/${f}.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + f));
    document.body.appendChild(s);
  });
}
