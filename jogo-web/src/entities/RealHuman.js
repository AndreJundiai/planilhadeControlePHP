import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/**
 * Realistic human: "Nathan Animated 003 - Walking 3D Man" by Renderpeople (CC-BY-4.0, see
 * public/models/nathan/license.txt). Photo-scanned, ~21k triangles, baked in-place walk cycle.
 * One model, many people: a shader recolours the clothes (white T-shirt → shirt colour,
 * jeans → trousers colour) while keeping skin, hair and shoes, so every clone looks different.
 */
const URL = './models/nathan/scene.gltf';
const HEIGHT = 1.78;
const WALK_SPEED = 1.35; // m/s that matches the clip at timeScale 1
let base = null;

export async function loadRealHuman() {
  if (base) return base;
  const gltf = await new GLTFLoader().loadAsync(URL);
  const scene = gltf.scene;
  const box = new THREE.Box3().setFromObject(scene);
  const s = HEIGHT / (box.max.y - box.min.y);
  const root = new THREE.Group();
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;
  root.add(scene);
  let map = null;
  scene.traverse((o) => {
    if (o.isMesh) { map = o.material.map; o.frustumCulled = false; o.castShadow = false; }
  });
  base = { root, clip: gltf.animations[0], map };
  return base;
}

export const realHumanReady = () => !!base;

// variant: null = roupa original (André); { shirt, pants } = recolor
const mats = new Map();
function material(variant) {
  const key = variant ? `${variant.shirt}_${variant.pants}` : 'orig';
  if (mats.has(key)) return mats.get(key);
  const m = new THREE.MeshLambertMaterial({ map: base.map });
  if (variant) {
    const shirt = new THREE.Color(variant.shirt), pants = new THREE.Color(variant.pants);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uShirt = { value: shirt };
      sh.uniforms.uPants = { value: pants };
      sh.fragmentShader = 'uniform vec3 uShirt;\nuniform vec3 uPants;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
          float blueish = step(c.r * 1.08, c.b) * step(0.12, sat);        // jeans
          float whiteish = step(sat, 0.14) * step(0.32, mx);               // camiseta branca
          float skin = step(c.b * 1.15, c.r) * step(0.15, sat);            // pele (avermelhada) fica igual
          float shade = dot(c, vec3(0.333));
          diffuseColor.rgb = mix(c, uPants * (0.55 + shade * 2.0), blueish * (1.0 - skin));
          diffuseColor.rgb = mix(diffuseColor.rgb, uShirt * (0.4 + shade * 1.3), whiteish * (1.0 - skin) * (1.0 - blueish));
        }`);
    };
    // UM shader para todas as roupas (as cores são uniforms de cada material). Antes cada combinação
    // de cores compilava um shader novo: o jogo travava toda vez que aparecia um pedestre de roupa nova.
    m.customProgramCacheKey = () => 'recolor';
  }
  mats.set(key, m);
  return m;
}

/** Creates an animated clone. Returns { root, mixer, action }. */
export function makeRealHuman(variant = null) {
  const root = SkeletonUtils.clone(base.root);
  const mat = material(variant);
  root.traverse((o) => { if (o.isMesh) o.material = mat; });
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(base.clip);
  action.play();
  return { root, mixer, action };
}

/** speed in m/s: 0 = standing (cycle frozen on a neutral frame), higher plays faster. */
export function animateRealHuman(h, dt, speed) {
  if (speed < 0.2) {
    h.action.timeScale = 0;
    h.action.time = 0.05;
  } else {
    h.action.timeScale = Math.min(3.6, speed / WALK_SPEED); // passo acompanha a velocidade (sem "patinar")
  }
  h.mixer.update(dt);
}

export const REAL_VARIANTS = [
  { shirt: 0xd94b4b, pants: 0x2c3e66 }, { shirt: 0x2e8b57, pants: 0x333333 }, { shirt: 0xf0b429, pants: 0x5b4a3a },
  { shirt: 0x3f7fd6, pants: 0x22252b }, { shirt: 0x6b4fa3, pants: 0x7a8691 }, { shirt: 0x222222, pants: 0x1d2a44 },
  { shirt: 0xe57aa1, pants: 0x3a4a6a }, { shirt: 0x8a6f4d, pants: 0x26334d }, { shirt: 0xf2f2f2, pants: 0x5a3a22 },
];
