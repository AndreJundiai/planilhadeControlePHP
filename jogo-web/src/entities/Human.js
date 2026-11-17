import * as THREE from 'three';

// Boneco low-poly compartilhado por André e pelos NPCs (geometrias/materiais reaproveitados).
const geo = {
  torso: new THREE.BoxGeometry(0.46, 0.6, 0.26),
  hips: new THREE.BoxGeometry(0.42, 0.16, 0.24),
  head: new THREE.SphereGeometry(0.15, 12, 10),
  hair: new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  leg: new THREE.BoxGeometry(0.17, 0.86, 0.19).translate(0, -0.43, 0),
  arm: new THREE.BoxGeometry(0.13, 0.62, 0.14).translate(0, -0.31, 0),
};
const mats = new Map();
const mat = (c) => mats.get(c) || mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })).get(c);

const SHIRTS = [0xd94b4b, 0x3f7fd6, 0xf2f2f2, 0x2e8b57, 0xf0b429, 0x6b4fa3, 0x222222, 0xe57aa1];
const PANTS = [0x26334d, 0x333333, 0x5b4a3a, 0x7a8691, 0x1d2a44];
const SKINS = [0xf1c8a5, 0xc4906a, 0x8d5a3b, 0x5c3a24, 0xe0ac85];
const HAIRS = [0x1a120c, 0x3b2414, 0x777777, 0xc89b5a, 0x0d0d0d];

export const randomLook = (i) => ({
  shirt: SHIRTS[(i * 7) % SHIRTS.length], pants: PANTS[(i * 3) % PANTS.length],
  skin: SKINS[(i * 5) % SKINS.length], hair: HAIRS[(i * 11) % HAIRS.length],
});

export function makeHuman({ shirt, pants, skin, hair }) {
  const g = new THREE.Group();
  const add = (gm, c, x, y, z, parent = g) => {
    const o = new THREE.Mesh(gm, mat(c)); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
  };
  add(geo.torso, shirt, 0, 1.25, 0);
  add(geo.hips, pants, 0, 0.92, 0);
  add(geo.head, skin, 0, 1.72, 0);
  add(geo.hair, hair, 0, 1.74, -0.01);
  const limbs = [];
  for (const x of [-0.12, 0.12]) { const p = new THREE.Group(); p.position.set(x, 0.9, 0); g.add(p); add(geo.leg, pants, 0, 0, 0, p); limbs.push(p); }
  for (const x of [-0.31, 0.31]) { const p = new THREE.Group(); p.position.set(x, 1.52, 0); g.add(p); add(geo.arm, shirt, 0, 0, 0, p); limbs.push(p); }
  g.userData.limbs = limbs;
  return g;
}

export function animateHuman(g, phase, amp) {
  const l = g.userData.limbs, s = Math.sin(phase) * amp;
  l[0].rotation.x = s; l[1].rotation.x = -s; l[2].rotation.x = -s * 0.8; l[3].rotation.x = s * 0.8;
}
