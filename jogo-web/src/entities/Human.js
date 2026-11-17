import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly articulated human (~1.6k triangles): hips → spine → neck/head, shoulders → elbows,
 * hip joints → knees → ankles. Geometry is baked relative to each joint, so the same rig drives
 * André (real meshes) and the crowd (one InstancedMesh per body part, see CrowdRenderer).
 * Vertex colours hold shading details (eyes, brows, mouth); the part colour (skin, shirt...)
 * is multiplied on top, per material or per instance.
 */
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const sph = (r, ws = 14, hs = 10, ts = 0, tl = Math.PI) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, ts, tl);

function tint(geo, v = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count, a = new Float32Array(n * 3).fill(v);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const merge = (...gs) => mergeGeometries(gs);

export const PARTS = {
  pelvis: merge(tint(cyl(0.165, 0.15, 0.22).scale(1, 1, 0.68).translate(0, -0.02, 0))),
  torso: merge(
    tint(cyl(0.185, 0.158, 0.36).scale(1, 1, 0.62).translate(0, 0.2, 0)),
    tint(cyl(0.205, 0.185, 0.14).scale(1, 1, 0.62).translate(0, 0.44, 0)),
    tint(sph(0.068, 10, 8).translate(-0.2, 0.45, 0)),
    tint(sph(0.068, 10, 8).translate(0.2, 0.45, 0)),
  ),
  head: merge(
    tint(cyl(0.05, 0.055, 0.1, 10).translate(0, 0.04, 0)), // pescoço
    tint(sph(0.112, 16, 12).scale(0.92, 1.1, 1).translate(0, 0.17, 0.005)),
    tint(box(0.028, 0.045, 0.035).translate(0, 0.16, 0.112)), // nariz
    tint(box(0.026, 0.016, 0.01).translate(-0.04, 0.195, 0.104), 0.08), // olhos
    tint(box(0.026, 0.016, 0.01).translate(0.04, 0.195, 0.104), 0.08),
    tint(box(0.04, 0.012, 0.012).translate(-0.04, 0.218, 0.103), 0.3), // sobrancelhas
    tint(box(0.04, 0.012, 0.012).translate(0.04, 0.218, 0.103), 0.3),
    tint(box(0.05, 0.012, 0.01).translate(0, 0.118, 0.105), 0.55), // boca
    tint(box(0.022, 0.05, 0.035).translate(-0.105, 0.17, 0)), // orelhas
    tint(box(0.022, 0.05, 0.035).translate(0.105, 0.17, 0)),
  ),
  // cabelo cobre topo e nuca, acima das sobrancelhas (a testa fica livre)
  hairShort: merge(tint(sph(0.122, 16, 8, 0, Math.PI * 0.42).scale(0.96, 1.0, 1.04).translate(0, 0.205, -0.02)), tint(box(0.2, 0.16, 0.07).translate(0, 0.17, -0.08))),
  hairLong: merge(tint(sph(0.124, 16, 8, 0, Math.PI * 0.44).scale(0.98, 1.0, 1.06).translate(0, 0.205, -0.02)), tint(box(0.22, 0.34, 0.07).translate(0, 0.08, -0.085)),
    tint(box(0.05, 0.22, 0.09).translate(-0.1, 0.12, -0.03)), tint(box(0.05, 0.22, 0.09).translate(0.1, 0.12, -0.03))),
  upperArm: merge(tint(cyl(0.055, 0.046, 0.3).translate(0, -0.15, 0))),
  forearm: merge(tint(cyl(0.044, 0.036, 0.25).translate(0, -0.125, 0)), tint(box(0.065, 0.1, 0.035).translate(0, -0.3, 0.005))),
  thigh: merge(tint(cyl(0.085, 0.06, 0.43).translate(0, -0.215, 0))),
  shin: merge(tint(cyl(0.06, 0.042, 0.41).translate(0, -0.205, 0))),
  shoe: merge(tint(box(0.1, 0.07, 0.25).translate(0, -0.035, 0.045)), tint(box(0.104, 0.02, 0.254).translate(0, -0.06, 0.045), 1.6)),
};
export const PAIRED = new Set(['upperArm', 'forearm', 'thigh', 'shin', 'shoe']);

const SHIRTS = [0xd94b4b, 0x3f7fd6, 0xf2f2f2, 0x2e8b57, 0xf0b429, 0x6b4fa3, 0x2a2a2a, 0xe57aa1, 0x8a6f4d, 0x9fb7c9];
const PANTS = [0x26334d, 0x333333, 0x5b4a3a, 0x7a8691, 0x1d2a44, 0xb9a987];
const SKINS = [0xf1c8a5, 0xc4906a, 0x8d5a3b, 0x5c3a24, 0xe0ac85, 0xa8714a];
const HAIRS = [0x1a120c, 0x3b2414, 0x777777, 0xc89b5a, 0x0d0d0d, 0x5a3418];
const SHOES = [0xf2f2f2, 0x1a1a1a, 0x5a3a22, 0x2a4a8a, 0x888888];
const pick = (arr, i, k) => arr[(i * k + (i >> 2)) % arr.length];

export const ANDRE_LOOK = { shirt: 0x1d5fbf, pants: 0x2c3e66, skin: 0xb07a52, hair: 0x15100c, shoes: 0xf4f4f4, hairStyle: 'hairShort', longSleeve: false, shorts: false, h: 1.0, w: 1.0 };

export function randomLook(i) {
  const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const hs = r(1);
  return {
    shirt: pick(SHIRTS, i, 7), pants: pick(PANTS, i, 3), skin: pick(SKINS, i, 5), hair: pick(HAIRS, i, 11), shoes: pick(SHOES, i, 13),
    hairStyle: hs < 0.12 ? 'none' : hs < 0.45 ? 'hairLong' : 'hairShort',
    longSleeve: r(2) < 0.3, shorts: r(3) < 0.25,
    h: 0.92 + r(4) * 0.14, w: 0.9 + r(5) * 0.25,
  };
}

const matCache = new Map();
const partMat = (hex) => matCache.get(hex) || matCache.set(hex, new THREE.MeshLambertMaterial({ vertexColors: true, color: hex })).get(hex);

/** Builds the joint hierarchy. withMeshes=true attaches real meshes (André); false = crowd rig only. */
export function makeHuman(look, withMeshes = false) {
  const root = new THREE.Group(), j = {};
  const node = (name, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); j[name] = o; return o; };
  node('hips', root, 0, 0.97, 0);
  node('spine', j.hips, 0, 0.08, 0);
  node('neck', j.spine, 0, 0.47, 0);
  for (const [s, x] of [['L', 0.2], ['R', -0.2]]) {
    node('shoulder' + s, j.spine, x, 0.43, 0);
    node('elbow' + s, j['shoulder' + s], 0, -0.3, 0);
    node('hip' + s, j.hips, x * 0.45, -0.06, 0);
    node('knee' + s, j['hip' + s], 0, -0.43, 0);
    node('ankle' + s, j['knee' + s], 0, -0.41, 0);
  }
  root.scale.setScalar(look.h);
  j.spine.scale.set(look.w, 1, 0.5 + look.w * 0.5);
  const parts = [
    ['pelvis', j.hips, look.pants], ['torso', j.spine, look.shirt], ['head', j.neck, look.skin],
    ['upperArm', j.shoulderL, look.shirt], ['upperArm', j.shoulderR, look.shirt],
    ['forearm', j.elbowL, look.longSleeve ? look.shirt : look.skin], ['forearm', j.elbowR, look.longSleeve ? look.shirt : look.skin],
    ['thigh', j.hipL, look.pants], ['thigh', j.hipR, look.pants],
    ['shin', j.kneeL, look.shorts ? look.skin : look.pants], ['shin', j.kneeR, look.shorts ? look.skin : look.pants],
    ['shoe', j.ankleL, look.shoes], ['shoe', j.ankleR, look.shoes],
  ];
  if (look.hairStyle !== 'none') parts.push([look.hairStyle, j.neck, look.hair]);
  if (withMeshes) for (const [name, n, hex] of parts) { const m = new THREE.Mesh(PARTS[name], partMat(hex)); n.add(m); }
  root.userData = { j, parts, look };
  return root;
}

export function setHumanShadow() { /* blob shadows: sombra dinâmica desligada para pessoas */ }

/** Walk/run cycle. amp: 0 parado, ~0.5 andando, >0.85 correndo. */
export function animateHuman(g, phase, amp) {
  const J = g.userData.j, run = amp > 0.85, s = Math.sin(phase);
  const leg = amp * (run ? 0.8 : 0.55), arm = amp * (run ? 0.9 : 0.45);
  J.hipL.rotation.x = -s * leg;
  J.hipR.rotation.x = s * leg;
  // knee bends while the foot travels back (phase-shifted), never hyper-extends
  J.kneeL.rotation.x = 0.06 + Math.max(0, Math.sin(phase + 1.3)) * leg * 1.5;
  J.kneeR.rotation.x = 0.06 + Math.max(0, Math.sin(phase + 1.3 + Math.PI)) * leg * 1.5;
  J.ankleL.rotation.x = -J.kneeL.rotation.x * 0.25;
  J.ankleR.rotation.x = -J.kneeR.rotation.x * 0.25;
  J.shoulderL.rotation.set(s * arm, 0, 0.07);
  J.shoulderR.rotation.set(-s * arm, 0, -0.07);
  const elbow = run ? -1.4 : -0.15 - amp * 0.35;
  J.elbowL.rotation.x = elbow;
  J.elbowR.rotation.x = elbow;
  J.spine.rotation.set(run ? 0.16 : 0.02, s * 0.08 * amp, 0);
  J.neck.rotation.x = -J.spine.rotation.x * 0.7;
  J.hips.position.y = 0.97 - (amp > 0 ? 0.02 - Math.abs(Math.cos(phase)) * 0.035 * amp : 0);
}
