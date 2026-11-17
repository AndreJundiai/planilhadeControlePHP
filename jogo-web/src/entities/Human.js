import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Boneco low-poly (André e NPCs). Corpo = 1 malha com cores por vértice + 4 membros animados.
// Um único material para todas as pessoas: poucas chamadas de desenho para a placa de vídeo.
const BASE = {
  torso: new THREE.BoxGeometry(0.46, 0.6, 0.26).translate(0, 1.25, 0),
  hips: new THREE.BoxGeometry(0.42, 0.16, 0.24).translate(0, 0.92, 0),
  head: new THREE.SphereGeometry(0.15, 10, 8).translate(0, 1.72, 0),
  hair: new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.74, -0.01),
  leg: new THREE.BoxGeometry(0.17, 0.86, 0.19).translate(0, -0.43, 0),
  arm: new THREE.BoxGeometry(0.13, 0.62, 0.14).translate(0, -0.31, 0),
};
const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const cache = new Map();

function colored(geo, hex) {
  const g = geo.clone(), c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const cached = (key, make) => cache.get(key) || cache.set(key, make()).get(key);

const SHIRTS = [0xd94b4b, 0x3f7fd6, 0xf2f2f2, 0x2e8b57, 0xf0b429, 0x6b4fa3, 0x222222, 0xe57aa1];
const PANTS = [0x26334d, 0x333333, 0x5b4a3a, 0x7a8691, 0x1d2a44];
const SKINS = [0xf1c8a5, 0xc4906a, 0x8d5a3b, 0x5c3a24, 0xe0ac85];
const HAIRS = [0x1a120c, 0x3b2414, 0x777777, 0xc89b5a, 0x0d0d0d];

export const randomLook = (i) => ({
  shirt: SHIRTS[(i * 7) % SHIRTS.length], pants: PANTS[(i * 3) % PANTS.length],
  skin: SKINS[(i * 5) % SKINS.length], hair: HAIRS[(i * 11) % HAIRS.length],
});

export function makeHuman({ shirt, pants, skin, hair }, castShadow = false) { // blob shadow em vez de sombra dinâmica
  const g = new THREE.Group();
  const body = cached(`b${shirt}_${pants}_${skin}_${hair}`, () =>
    mergeGeometries([colored(BASE.torso, shirt), colored(BASE.hips, pants), colored(BASE.head, skin), colored(BASE.hair, hair)]));
  const mk = (geo, parent) => { const m = new THREE.Mesh(geo, MAT); m.castShadow = castShadow; parent.add(m); return m; };
  mk(body, g);
  const limbs = [];
  const leg = cached(`l${pants}`, () => colored(BASE.leg, pants)), arm = cached(`a${shirt}`, () => colored(BASE.arm, shirt));
  for (const [geo, x, y] of [[leg, -0.12, 0.9], [leg, 0.12, 0.9], [arm, -0.31, 1.52], [arm, 0.31, 1.52]]) {
    const p = new THREE.Group();
    p.position.set(x, y, 0);
    g.add(p);
    mk(geo, p);
    limbs.push(p);
  }
  g.userData.limbs = limbs;
  return g;
}

export function setHumanShadow(g, on) { g.traverse((o) => { if (o.isMesh) o.castShadow = on; }); }

export function animateHuman(g, phase, amp) {
  const l = g.userData.limbs, s = Math.sin(phase) * amp;
  l[0].rotation.x = s; l[1].rotation.x = -s; l[2].rotation.x = -s * 0.8; l[3].rotation.x = s * 0.8;
}
