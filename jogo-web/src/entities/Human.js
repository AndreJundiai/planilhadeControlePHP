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
// corpo feminino: cintura mais fina, ombros mais estreitos, quadril mais largo
PARTS.torsoF = merge(
  tint(cyl(0.175, 0.14, 0.36).scale(1, 1, 0.62).translate(0, 0.2, 0)),
  tint(cyl(0.185, 0.17, 0.14).scale(1, 1, 0.66).translate(0, 0.43, 0)),
  tint(sph(0.06, 10, 8).translate(-0.18, 0.44, 0)),
  tint(sph(0.06, 10, 8).translate(0.18, 0.44, 0)),
);
PARTS.pelvisF = merge(tint(cyl(0.16, 0.175, 0.22).scale(1, 1, 0.7).translate(0, -0.02, 0)));
// roupas e acessórios (cada um é uma peça com cor própria)
const shell = (g, sx, sy, sz) => g.clone().scale(sx, sy, sz);
PARTS.jacket = shell(PARTS.torso, 1.07, 1.02, 1.12);
PARTS.jacketF = shell(PARTS.torsoF, 1.07, 1.02, 1.12);
PARTS.shirtFront = merge(tint(box(0.1, 0.34, 0.02).translate(0, 0.35, 0.118)));
PARTS.tie = merge(tint(box(0.045, 0.27, 0.015).translate(0, 0.33, 0.13)));
PARTS.vest = merge(tint(cyl(0.2, 0.172, 0.4).scale(1, 1, 0.66).translate(0, 0.25, 0)), tint(cyl(0.203, 0.19, 0.045, 14).scale(1, 1, 0.67).translate(0, 0.2, 0), 1.9), tint(cyl(0.21, 0.2, 0.045, 14).scale(1, 1, 0.67).translate(0, 0.36, 0), 1.9));
PARTS.coatTail = merge(tint(cyl(0.19, 0.24, 0.42, 14).scale(1, 1, 0.72).translate(0, -0.18, 0)));
PARTS.skirt = merge(tint(cyl(0.17, 0.26, 0.32, 16).scale(1, 1, 0.78).translate(0, -0.15, 0)));
PARTS.dress = merge(tint(cyl(0.17, 0.3, 0.7, 16).scale(1, 1, 0.8).translate(0, -0.33, 0)));
PARTS.cap = merge(tint(sph(0.126, 16, 6, 0, Math.PI * 0.42).translate(0, 0.21, -0.01)), tint(box(0.17, 0.015, 0.11).translate(0, 0.228, 0.125)));
PARTS.hardhat = merge(tint(sph(0.138, 16, 8, 0, Math.PI * 0.5).translate(0, 0.21, 0)), tint(cyl(0.165, 0.165, 0.016, 18).translate(0, 0.212, 0.01)));
PARTS.policeCap = merge(tint(cyl(0.128, 0.12, 0.08, 16).translate(0, 0.27, 0)), tint(cyl(0.148, 0.13, 0.03, 16).translate(0, 0.315, 0.005)), tint(box(0.16, 0.015, 0.08, 1).translate(0, 0.243, 0.12), 0.4), tint(box(0.04, 0.03, 0.01).translate(0, 0.285, 0.13), 2.2));
PARTS.cowboyHat = merge(tint(cyl(0.25, 0.25, 0.016, 22).translate(0, 0.25, 0)), tint(cyl(0.1, 0.12, 0.13, 14).translate(0, 0.32, 0)), tint(cyl(0.123, 0.123, 0.025, 14).translate(0, 0.27, 0), 0.5));
PARTS.beard = merge(tint(box(0.17, 0.08, 0.07).translate(0, 0.11, 0.075)), tint(box(0.06, 0.02, 0.02).translate(0, 0.14, 0.114)));
PARTS.glasses = merge(tint(box(0.07, 0.035, 0.02).translate(-0.042, 0.197, 0.113)), tint(box(0.07, 0.035, 0.02).translate(0.042, 0.197, 0.113)), tint(box(0.2, 0.01, 0.01).translate(0, 0.205, 0.105)));
PARTS.mohawk = merge(tint(box(0.03, 0.09, 0.24).translate(0, 0.3, -0.01)));
PARTS.backpack = merge(tint(box(0.4, 0.4, 0.34).translate(0, 0.32, -0.32)), tint(box(0.41, 0.06, 0.35).translate(0, 0.42, -0.32), 1.5));
PARTS.handbag = merge(tint(box(0.22, 0.17, 0.08).translate(0, -0.42, 0.02)), tint(box(0.015, 0.12, 0.015).translate(0, -0.29, 0.02), 0.5));

export const PAIRED = new Set(['upperArm', 'forearm', 'thigh', 'shin', 'shoe']);

const SHIRTS = [0xd94b4b, 0x3f7fd6, 0xf2f2f2, 0x2e8b57, 0xf0b429, 0x6b4fa3, 0x2a2a2a, 0xe57aa1, 0x8a6f4d, 0x9fb7c9];
const PANTS = [0x26334d, 0x333333, 0x5b4a3a, 0x7a8691, 0x1d2a44, 0xb9a987];
const SKINS = [0xf1c8a5, 0xc4906a, 0x8d5a3b, 0x5c3a24, 0xe0ac85, 0xa8714a];
const HAIRS = [0x1a120c, 0x3b2414, 0x777777, 0xc89b5a, 0x0d0d0d, 0x5a3418];
const SHOES = [0xf2f2f2, 0x1a1a1a, 0x5a3a22, 0x2a4a8a, 0x888888];
const pick = (arr, i, k) => arr[(i * k + (i >> 2)) % arr.length];

export const ANDRE_LOOK = { body: 'm', shirt: 0x1d5fbf, pants: 0x2c3e66, skin: 0xb07a52, hair: 0x15100c, shoes: 0xf4f4f4, hairStyle: 'hairShort', longSleeve: false, shorts: false, h: 1.0, w: 1.0 };

const FLORAL = [0xe05a8a, 0x2bb3a3, 0xf2a33a, 0x5aa0e0];
const DRESS = [0xc0392b, 0x8e44ad, 0x2e86c1, 0x16a085, 0xf5b7b1, 0x222222, 0xf1c40f];

// Tipos de pedestre de Jundiaí (peso = frequência na rua). Cada um preenche roupas e acessórios.
const ARCHETYPES = [
  ['casual', 30, () => ({})],
  ['mulherCasual', 14, (r) => ({ body: 'f', hairStyle: 'hairLong', pants: r(9) < 0.5 ? 0x3a4a6a : pick(PANTS, (r(8) * 10) | 0, 3), bag: r(7) < 0.5 ? pick(DRESS, (r(6) * 9) | 0, 1) : null })],
  ['mulherVestido', 8, (r) => { const c = pick(DRESS, (r(6) * 9) | 0, 1); return { body: 'f', hairStyle: 'hairLong', shirt: c, dress: c, shorts: true, longSleeve: false, shoes: 0x2a1a1a, bag: r(7) < 0.6 ? 0x6b3a1a : null }; }],
  ['mulherSaia', 5, (r) => ({ body: 'f', hairStyle: r(5) < 0.7 ? 'hairLong' : 'hairShort', skirt: pick(DRESS, (r(4) * 9) | 0, 2), shorts: true, shoes: 0x1a1a1a })],
  ['executivo', 6, (r) => ({ shirt: 0xf2f2f2, jacket: r(3) < 0.5 ? 0x22252b : 0x34404f, tie: [0x9b1c1c, 0x1d3f8f, 0x333333][(r(2) * 3) | 0], pants: 0x22252b, shoes: 0x111111, longSleeve: true, hairStyle: 'hairShort' })],
  ['seguranca', 2, () => ({ shirt: 0xf2f2f2, jacket: 0x111111, tie: 0x111111, pants: 0x111111, shoes: 0x111111, longSleeve: true, glasses: 0x111111, hairStyle: 'none', w: 1.2, h: 1.05 })],
  ['policial', 4, () => ({ shirt: 0x7a8794, pants: 0x2f3742, shoes: 0x111111, vest: 0x1e2226, hat: ['policeCap', 0x2a323c], longSleeve: false, hairStyle: 'hairShort' })],
  ['bombeiro', 2, () => ({ shirt: 0xb8372a, pants: 0xb8372a, shoes: 0x111111, vest: 0xd8a62a, hat: ['hardhat', 0xc0392b], longSleeve: true })],
  ['medico', 3, (r) => ({ shirt: 0x7fb3b0, pants: 0x7fb3b0, jacket: 0xf6f6f6, coat: 0xf6f6f6, shoes: 0xf2f2f2, longSleeve: true, body: r(3) < 0.5 ? 'f' : 'm', hairStyle: r(3) < 0.5 ? 'hairLong' : 'hairShort' })],
  ['pedreiro', 4, (r) => ({ shirt: pick(SHIRTS, (r(2) * 10) | 0, 1), pants: 0x3a4a6a, vest: 0xff7a1a, hat: ['hardhat', 0xf2c12e], shoes: 0x4a3420, longSleeve: r(3) < 0.4 })],
  ['gari', 3, () => ({ shirt: 0xf07a1a, pants: 0xf07a1a, vest: 0xf07a1a, hat: ['cap', 0xf07a1a], shoes: 0x111111, longSleeve: true })],
  ['entregador', 5, (r) => { const c = [0xd2261a, 0x1aa35a, 0xf2a900][(r(2) * 3) | 0]; return { shirt: c, backpack: c, hat: r(3) < 0.6 ? ['cap', 0x111111] : null }; }],
  ['idoso', 5, (r) => ({ hair: 0xcfcfcf, hairStyle: r(2) < 0.4 ? 'none' : 'hairShort', jacket: [0x6b4f3a, 0x55606b, 0x7a6a4a][(r(3) * 3) | 0], shirt: 0xe8e2d0, pants: 0x8a7a5a, longSleeve: true, beard: r(4) < 0.35 ? 0xd8d8d8 : null, h: 0.94, slow: true })],
  ['turista', 3, (r) => ({ shirt: pick(FLORAL, (r(2) * 4) | 0, 1), shorts: true, pants: 0xc9b68a, glasses: 0x111111, hat: r(3) < 0.6 ? ['cowboyHat', 0xe8d8a8] : ['cap', 0xf2f2f2], shoes: 0x8a6a4a })],
  ['caipira', 3, (r) => ({ shirt: [0x9b3a2a, 0x3a6b9b, 0x5a7a3a][(r(2) * 3) | 0], pants: 0x2c3e66, hat: ['cowboyHat', 0x6b4a2a], shoes: 0x4a2e1a, beard: r(4) < 0.5 ? 0x2a1a10 : null, longSleeve: true })],
  ['jovem', 6, (r) => ({ hairStyle: r(2) < 0.25 ? 'mohawk' : 'hairShort', hat: r(3) < 0.4 ? ['cap', pick(SHIRTS, (r(5) * 10) | 0, 1)] : null, shorts: r(4) < 0.5, shoes: 0xf4f4f4 })],
];
const TOTAL = ARCHETYPES.reduce((n, a) => n + a[1], 0);

export function randomLook(i) {
  const r = (k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  const hs = r(1);
  const base = {
    body: 'm', shirt: pick(SHIRTS, i, 7), pants: pick(PANTS, i, 3), skin: pick(SKINS, i, 5), hair: pick(HAIRS, i, 11), shoes: pick(SHOES, i, 13),
    hairStyle: hs < 0.12 ? 'none' : hs < 0.3 ? 'hairLong' : 'hairShort',
    longSleeve: r(2) < 0.3, shorts: r(3) < 0.25,
    h: 0.93 + r(4) * 0.13, w: 0.9 + r(5) * 0.25,
  };
  let t = r(10) * TOTAL, arch = ARCHETYPES[0];
  for (const a of ARCHETYPES) { if ((t -= a[1]) < 0) { arch = a; break; } }
  const look = { ...base, ...arch[2]((k) => r(20 + k)), kind: arch[0] };
  if (look.body === 'f') { look.h *= 0.94; look.w = Math.min(look.w, 1.0); }
  return look;
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
  const fem = look.body === 'f', sh = fem ? 0.18 : 0.2;
  for (const [s, x] of [['L', sh], ['R', -sh]]) {
    node('shoulder' + s, j.spine, x, 0.43, 0);
    node('elbow' + s, j['shoulder' + s], 0, -0.3, 0);
    node('hip' + s, j.hips, x * 0.45, -0.06, 0);
    node('knee' + s, j['hip' + s], 0, -0.43, 0);
    node('ankle' + s, j['knee' + s], 0, -0.41, 0);
  }
  root.scale.setScalar(look.h);
  j.spine.scale.set(look.w, 1, 0.5 + look.w * 0.5);
  const sleeve =look.jacket ?? look.shirt, legTop = look.dress ? look.skin : look.pants;
  const parts = [
    [fem ? 'pelvisF' : 'pelvis', j.hips, look.dress ?? look.pants], [fem ? 'torsoF' : 'torso', j.spine, look.shirt], ['head', j.neck, look.skin],
    ['upperArm', j.shoulderL, sleeve], ['upperArm', j.shoulderR, sleeve],
    ['forearm', j.elbowL, look.longSleeve || look.jacket ? sleeve : look.skin], ['forearm', j.elbowR, look.longSleeve || look.jacket ? sleeve : look.skin],
    ['thigh', j.hipL, legTop], ['thigh', j.hipR, legTop],
    ['shin', j.kneeL, look.shorts ? look.skin : look.pants], ['shin', j.kneeR, look.shorts ? look.skin : look.pants],
    ['shoe', j.ankleL, look.shoes], ['shoe', j.ankleR, look.shoes],
  ];
  const hatOn = !!look.hat;
  if (look.hairStyle === 'mohawk') parts.push(['mohawk', j.neck, look.hair]);
  else if (look.hairStyle !== 'none' && !(hatOn && look.hairStyle === 'hairShort')) parts.push([look.hairStyle, j.neck, look.hair]);
  if (hatOn) parts.push([look.hat[0], j.neck, look.hat[1]]);
  if (look.jacket) { parts.push([fem ? 'jacketF' : 'jacket', j.spine, look.jacket]); if (!look.coat) parts.push(['shirtFront', j.spine, look.shirt]); }
  if (look.coat) parts.push(['coatTail', j.hips, look.coat]);
  if (look.tie) parts.push(['tie', j.spine, look.tie]);
  if (look.vest) parts.push(['vest', j.spine, look.vest]);
  if (look.dress) parts.push(['dress', j.hips, look.dress]);
  if (look.skirt) parts.push(['skirt', j.hips, look.skirt]);
  if (look.beard) parts.push(['beard', j.neck, look.beard]);
  if (look.glasses) parts.push(['glasses', j.neck, look.glasses]);
  if (look.backpack) parts.push(['backpack', j.spine, look.backpack]);
  if (look.bag) parts.push(['handbag', j.elbowR, look.bag]);
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
