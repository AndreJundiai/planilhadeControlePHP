import * as THREE from 'three';
import { clamp, quatY } from '../core/math.js';

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Carro = 2 malhas (lataria+vidros+rodas numa só, e faróis noutra) com cores por vértice.
// Os materiais são os mesmos para todos os carros: muito menos trabalho para a placa de vídeo.
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const wheel = (x, z) => new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12).rotateZ(Math.PI / 2).translate(x, 0.36, z);
const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.32 });
const LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const BAR = new THREE.BoxGeometry(0.55, 0.14, 0.3);
const cache = new Map();

function colored(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function bodyGeometry(color) {
  if (cache.has(color)) return cache.get(color);
  const parts = [
    colored(box(1.9, 0.6, 4.3, 0, 0.72, 0), color),
    colored(box(1.6, 0.55, 2.1, 0, 1.27, -0.3), 0x0b0f16),
    colored(box(1.62, 0.06, 2.0, 0, 1.57, -0.32), color),
    colored(box(1.96, 0.22, 0.22, 0, 0.52, 2.15), 0x111111),
    colored(box(1.96, 0.22, 0.22, 0, 0.52, -2.15), 0x111111),
    ...[[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]].map(([x, z]) => colored(wheel(x, z), 0x111111)),
  ];
  const g = mergeGeometries(parts);
  cache.set(color, g);
  return g;
}

const LIGHTS = mergeGeometries([
  colored(box(0.42, 0.14, 0.05, -0.62, 0.85, 2.16), 0xfff2c0), colored(box(0.42, 0.14, 0.05, 0.62, 0.85, 2.16), 0xfff2c0),
  colored(box(0.42, 0.14, 0.05, -0.62, 0.85, -2.16), 0xff1a1a), colored(box(0.42, 0.14, 0.05, 0.62, 0.85, -2.16), 0xff1a1a),
]);

export function makeCarMesh(color, police = false) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(bodyGeometry(color), BODY_MAT);
  body.castShadow = true;
  g.add(body, new THREE.Mesh(LIGHTS, LIGHT_MAT));
  if (police) {
    const r = new THREE.Mesh(BAR, new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0 }));
    const b = new THREE.Mesh(BAR, new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x2050ff, emissiveIntensity: 0 }));
    r.position.set(-0.3, 1.67, -0.3);
    b.position.set(0.3, 1.67, -0.3);
    g.add(r, b);
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
