import * as THREE from 'three';
import { clamp, quatY } from '../core/math.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const G = {
  body: box(1.9, 0.6, 4.3), cabin: box(1.6, 0.55, 2.1), roof: box(1.62, 0.06, 2.0), bumper: box(1.96, 0.22, 0.22),
  light: box(0.42, 0.14, 0.05), bar: box(0.55, 0.14, 0.3),
  wheel: new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14).rotateZ(Math.PI / 2),
};
const M = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0b0f16, metalness: 0.8, roughness: 0.08 }),
  black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }),
  head: new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xfff2c0, emissiveIntensity: 1.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0xaa0000, emissive: 0xff1a1a, emissiveIntensity: 1.0 }),
};

export function makeCarMesh(color, police = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.1 });
  const add = (gm, m, x, y, z) => { const o = new THREE.Mesh(gm, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(G.body, paint, 0, 0.72, 0);
  add(G.cabin, M.glass, 0, 1.27, -0.3);
  add(G.roof, paint, 0, 1.57, -0.32);
  add(G.bumper, M.black, 0, 0.52, 2.15);
  add(G.bumper, M.black, 0, 0.52, -2.15);
  for (const x of [-0.62, 0.62]) { add(G.light, M.head, x, 0.85, 2.16); add(G.light, M.tail, x, 0.85, -2.16); }
  for (const [x, z] of [[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]]) add(G.wheel, M.black, x, 0.36, z);
  if (police) {
    const r = add(G.bar, new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0 }), -0.3, 1.67, -0.3);
    const b = add(G.bar, new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x2050ff, emissiveIntensity: 0 }), 0.3, 1.67, -0.3);
    g.userData.siren = [r, b];
  }
  return g;
}

export class Vehicle {
  constructor(color = 0xc81e1e, police = false) {
    this.mesh = makeCarMesh(color, police);
    this.pos = this.mesh.position;
    this.heading = 0;
    this.speed = 0; // m/s no eixo do carro
    this.lat = 0; // velocidade lateral (derrapagem)
    this.vx = 0;
    this.vz = 0;
    this.police = police;
    this.health = 100;
  }
  place(x, z, h) { this.pos.set(x, 0, z); this.heading = h; this.mesh.rotation.y = h; this.speed = this.lat = 0; }
  siren(on, t) {
    const s = this.mesh.userData.siren;
    if (!s) return;
    const f = Math.floor(t * 6) % 2;
    s[0].material.emissiveIntensity = on && f ? 3 : 0;
    s[1].material.emissiveIntensity = on && !f ? 3 : 0;
  }
}

// Física arcade do carro do jogador: aceleração, freio, ré, freio de mão e derrapagem.
// A colisão com prédios é resolvida pelo character controller do Rapier. Retorna a velocidade do impacto.
export function driveArcade(v, dt, input, phys) {
  const thr = input.down('KeyW', 'ArrowUp'), brk = input.down('KeyS', 'ArrowDown'), hand = input.down('Space');
  const steer = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
  const MAX = 36, REV = -9;
  if (thr) v.speed += (v.speed < 0 ? 22 : 10 * (1 - v.speed / MAX) + 1) * dt;
  if (brk) v.speed -= (v.speed > 0.5 ? 22 : 7) * dt;
  if (!thr && !brk) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3 * dt);
  if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
  v.speed = clamp(v.speed, REV, MAX);
  const grip = clamp(Math.abs(v.speed) / 6, 0, 1) / (1 + Math.abs(v.speed) * 0.025);
  const yawRate = steer * 1.9 * grip * (v.speed < 0 ? -1 : 1) * (hand ? 1.5 : 1);
  v.heading += yawRate * dt;
  v.lat += yawRate * Math.abs(v.speed) * (hand ? 0.35 : 0.1) * dt; // força centrífuga
  v.lat *= Math.exp(-(hand ? 1.2 : 6) * dt);
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = -fz, rz = fx;
  v.vx = fx * v.speed + rx * v.lat;
  v.vz = fz * v.speed + rz * v.lat;
  const want = { x: v.vx * dt, y: 0, z: v.vz * dt };
  phys.carBody.setNextKinematicRotation(quatY(v.heading));
  const res = phys.move(phys.carCtrl, phys.carBody, phys.carCollider, want, 0);
  let impact = 0;
  const wl = Math.hypot(want.x, want.z), ml = Math.hypot(res.moved.x, res.moved.z);
  if (wl > 0.02 && ml < wl * 0.55) { impact = Math.abs(v.speed); v.speed *= -0.25; v.lat *= 0.3; }
  v.pos.set(res.pos.x, 0, res.pos.z);
  v.mesh.rotation.y = v.heading;
  return impact;
}
