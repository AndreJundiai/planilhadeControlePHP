import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, quatY } from '../core/math.js';

/**
 * Low-poly car (~2–3k triangles): body and cabin are extruded side profiles with rounded edges
 * (bonnet, sloped windscreen, roof, boot, round wheel arches), plus wheels with rims and spokes,
 * grille, plates, mirrors and bumpers. Everything merges into 2 meshes with vertex colours
 * (body + lights), shared by every car: few draw calls.
 */
const TYPES = {
  sedan: { rear: -2.2, front: 2.2, belt: 0.95, trunk: 0.92, cabinRear: -1.2, roofRear: -0.82, roofFront: 0.32, cabinFront: 1.05, roof: 1.42, hood: 0.82, lift: 0, wheelR: 0.34 },
  hatch: { rear: -1.95, front: 2.05, belt: 0.95, trunk: 1.0, cabinRear: -1.8, roofRear: -1.58, roofFront: 0.3, cabinFront: 0.95, roof: 1.46, hood: 0.84, lift: 0, wheelR: 0.33 },
  suv: { rear: -2.25, front: 2.25, belt: 1.12, trunk: 1.12, cabinRear: -2.1, roofRear: -1.98, roofFront: 0.45, cabinFront: 1.08, roof: 1.74, hood: 1.02, lift: 0.12, wheelR: 0.38 },
};
export const CAR_TYPES = Object.keys(TYPES);

const BODY_MAT = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, reflectivity: 0.35, combine: THREE.MixOperation });
const LIGHT_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
const BAR = new THREE.BoxGeometry(0.55, 0.14, 0.3);
let WET = 0; // 0 = seco, 1 = chuva forte
export function setWetRoad(v) { WET = v; }
export function setCarEnvMap(tex) { BODY_MAT.envMap = tex; BODY_MAT.needsUpdate = true; }

function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Side profile (x = length, y = height) extruded across the car's width (world X).
function extrudeSide(shape, width, bevel = 0.05) {
  const d = width - bevel * 2;
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 20 });
  g.rotateY(-Math.PI / 2); // shape x → world z, extrusion → world -x
  g.translate(d / 2, 0, 0);
  return g;
}

function bodyShape(t) {
  const b = 0.3 + t.lift, s = new THREE.Shape(), ax = 1.35, r = t.wheelR + 0.08;
  s.moveTo(t.rear, b);
  s.lineTo(t.rear - 0.04, 0.68 + t.lift);
  s.lineTo(t.rear + 0.1, t.trunk);
  s.lineTo(t.cabinRear, t.belt);
  s.lineTo(t.cabinFront, t.belt);
  s.lineTo(t.front - 0.18, t.hood);
  s.lineTo(t.front + 0.03, 0.62 + t.lift);
  s.lineTo(t.front, b);
  s.lineTo(ax + r, b);
  s.absarc(ax, t.wheelR, r, 0, Math.PI, false); // para-lama dianteiro
  s.lineTo(-ax + r, b);
  s.absarc(-ax, t.wheelR, r, 0, Math.PI, false); // para-lama traseiro
  s.lineTo(t.rear, b);
  return s;
}

function cabinShape(t) {
  const s = new THREE.Shape();
  s.moveTo(t.cabinRear + 0.05, t.belt - 0.02);
  s.lineTo(t.roofRear, t.roof);
  s.lineTo(t.roofFront, t.roof + 0.01);
  s.lineTo(t.cabinFront - 0.05, t.belt - 0.02);
  s.lineTo(t.cabinRear + 0.05, t.belt - 0.02);
  return s;
}

function roofShape(t) {
  const s = new THREE.Shape();
  s.moveTo(t.roofRear + 0.02, t.roof - 0.04);
  s.lineTo(t.roofRear + 0.05, t.roof + 0.03);
  s.lineTo(t.roofFront - 0.03, t.roof + 0.04);
  s.lineTo(t.roofFront + 0.01, t.roof - 0.03);
  s.lineTo(t.roofRear + 0.02, t.roof - 0.04);
  return s;
}

function wheel(x, z, r) {
  const parts = [
    paint(new THREE.CylinderGeometry(r, r, 0.24, 32).rotateZ(Math.PI / 2).translate(x, r, z), 0x141414), // pneu
    paint(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.25, 20).rotateZ(Math.PI / 2).translate(x, r, z), 0x9a9a9a), // aro
    paint(new THREE.CylinderGeometry(r * 0.16, r * 0.16, 0.27, 10).rotateZ(Math.PI / 2).translate(x, r, z), 0xd8d8d8), // calota
    paint(new THREE.TorusGeometry(r * 0.82, 0.03, 6, 28).rotateY(Math.PI / 2).translate(x + Math.sign(x) * 0.12, r, z), 0x222222), // flanco do pneu
  ];
  for (let k = 0; k < 5; k++) { // raios
    const a = (k / 5) * Math.PI * 2, sp = new THREE.BoxGeometry(0.02, r * 1.1, 0.05);
    sp.rotateX(a);
    parts.push(paint(sp.translate(x + Math.sign(x) * 0.13, r, z), 0xc8c8c8));
  }
  return parts;
}

const cache = new Map();
function carGeometry(color, type, police) {
  const key = `${color}_${type}_${police}`;
  if (cache.has(key)) return cache.get(key);
  const t = TYPES[type], L = t.lift;
  const parts = [
    paint(extrudeSide(bodyShape(t), 1.8, 0.06), color),
    paint(extrudeSide(cabinShape(t), 1.56, 0.04), 0x0c1118),
    paint(extrudeSide(roofShape(t), 1.52, 0.02), color),
    paint(box(1.58, t.roof - t.belt - 0.06, 0.09, 0, (t.roof + t.belt) / 2, (t.roofRear + t.roofFront) / 2 - 0.1), color), // coluna B
    paint(box(1.0, 0.14, 0.04, 0, 0.6 + L, t.front + 0.04), 0x161616), // grade
    paint(box(1.86, 0.13, 0.14, 0, 0.4 + L, t.front - 0.01), 0x2a2a2a), // para-choques
    paint(box(1.86, 0.13, 0.14, 0, 0.4 + L, t.rear + 0.01), 0x2a2a2a),
    paint(box(0.4, 0.12, 0.02, 0, 0.47 + L, t.front + 0.07), 0xeeeee6), // placas brancas (Mercosul)
    paint(box(0.4, 0.12, 0.02, 0, 0.55 + L, t.rear - 0.05), 0xeeeee6),
    paint(box(0.18, 0.1, 0.1, 0.96, t.belt + 0.06, t.cabinFront - 0.18), color), // retrovisores
    paint(box(0.18, 0.1, 0.1, -0.96, t.belt + 0.06, t.cabinFront - 0.18), color),
    paint(box(0.012, 0.02, 0.9, 0.905, t.belt - 0.28, (t.cabinRear + t.cabinFront) / 2), 0x111111), // friso das portas
    paint(box(0.012, 0.02, 0.9, -0.905, t.belt - 0.28, (t.cabinRear + t.cabinFront) / 2), 0x111111),
    ...[[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]].flatMap(([x, z]) => wheel(x, z, t.wheelR)),
  ];
  for (const x of [0.91, -0.91]) { // maçanetas
    parts.push(paint(box(0.02, 0.035, 0.14, x, t.belt - 0.12, (t.cabinRear + t.cabinFront) / 2 + 0.35), 0x888888));
    parts.push(paint(box(0.02, 0.035, 0.14, x, t.belt - 0.12, (t.cabinRear + t.cabinFront) / 2 - 0.45), 0x888888));
  }
  parts.push(paint(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 10).rotateX(Math.PI / 2).translate(-0.55, 0.32 + L, t.rear - 0.02), 0x555555)); // escapamento
  if (police) { // faixa azul da viatura
    for (const x of [0.91, -0.91]) parts.push(paint(box(0.012, 0.14, t.front - t.rear - 0.6, x, 0.68 + L, 0), 0x1d3f8f));
  }
  const body = mergeGeometries(parts);
  const lights = mergeGeometries([
    paint(box(0.36, 0.12, 0.05, -0.6, t.hood - 0.1, t.front - 0.06), 0xfff2c0), paint(box(0.36, 0.12, 0.05, 0.6, t.hood - 0.1, t.front - 0.06), 0xfff2c0),
    paint(box(0.34, 0.12, 0.05, -0.62, t.trunk - 0.12, t.rear - 0.01), 0xff1a1a), paint(box(0.34, 0.12, 0.05, 0.62, t.trunk - 0.12, t.rear - 0.01), 0xff1a1a),
  ]);
  const out = { body, lights, roof: t.roof };
  cache.set(key, out);
  return out;
}

export function makeCarMesh(color, police = false, type = 'sedan') {
  const g = new THREE.Group(), geo = carGeometry(color, type, police);
  g.add(new THREE.Mesh(geo.body, BODY_MAT), new THREE.Mesh(geo.lights, LIGHT_MAT));
  if (police) {
    const r = new THREE.Mesh(BAR, new THREE.MeshLambertMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0 }));
    const b = new THREE.Mesh(BAR, new THREE.MeshLambertMaterial({ color: 0x000055, emissive: 0x2050ff, emissiveIntensity: 0 }));
    r.position.set(-0.3, geo.roof + 0.1, -0.25);
    b.position.set(0.3, geo.roof + 0.1, -0.25);
    g.add(r, b);
    g.userData.siren = [r, b];
  }
  return g;
}

export function carTriangles(type = 'sedan') {
  const { body, lights } = carGeometry(0xffffff, type, false);
  return (body.attributes.position.count + lights.attributes.position.count) / 3;
}

export class Vehicle {
  constructor(color = 0xc81e1e, police = false, type = 'sedan') {
    this.type = type;
    this.mesh = makeCarMesh(color, police, type);
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
  const ax = input.axis, hand = input.down('Space');
  // analógico no celular (acelerador e volante proporcionais), teclas no PC
  const thr = ax.active ? Math.max(0, -ax.y * 1.25 - 0.1) : input.down('KeyW', 'ArrowUp') ? 1 : 0;
  const brk = ax.active ? Math.max(0, ax.y * 1.25 - 0.1) : input.down('KeyS', 'ArrowDown') ? 1 : 0;
  const steerIn = ax.active ? -ax.x : (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
  // volante gira aos poucos e volta ao centro sozinho
  v.steer = (v.steer || 0) + (steerIn - (v.steer || 0)) * Math.min(1, (steerIn === 0 ? 7 : 4.5) * dt);
  const steer = v.steer;
  const MAX = 36, REV = -9;
  if (thr) v.speed += (v.speed < 0 ? 22 : 10 * (1 - v.speed / MAX) + 1) * Math.min(1, thr) * dt;
  if (brk) v.speed -= (v.speed > 0.5 ? 22 : 7) * Math.min(1, brk) * dt;
  if (!thr && !brk) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3 * dt);
  if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
  v.speed = clamp(v.speed, REV, MAX);
  const grip = clamp(Math.abs(v.speed) / 6, 0, 1) / (1 + Math.abs(v.speed) * 0.025);
  const yawRate = steer * 1.7 * grip * (v.speed < 0 ? -1 : 1) * (hand ? 1.5 : 1) / (1 + Math.abs(v.speed) * 0.012); // menos sensível em alta
  v.heading += yawRate * dt;
  v.lat += yawRate * Math.abs(v.speed) * (hand ? 0.35 : 0.1) * dt; // força centrífuga
  v.lat *= Math.exp(-(hand ? 1.2 : 6) * (1 - 0.55 * WET) * dt); // chuva: o carro escorrega mais
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
