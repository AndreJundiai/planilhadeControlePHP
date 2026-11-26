import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, quatY } from '../core/math.js';
import { TERRAIN_GLSL, heightAt } from '../render/Terrain.js';

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
  // esportivo baixo, capô longo e traseira fastback com aerofólio
  coupe: { rear: -2.15, front: 2.2, belt: 0.86, trunk: 0.84, cabinRear: -1.45, roofRear: -0.62, roofFront: 0.1, cabinFront: 0.95, roof: 1.26, hood: 0.72, lift: -0.02, wheelR: 0.35, extra: 'spoiler' },
  // picape cabine simples com caçamba (capota marítima) e santo-antônio
  pickup: { rear: -2.5, front: 2.2, belt: 1.0, trunk: 1.0, cabinRear: -0.55, roofRear: -0.48, roofFront: 0.38, cabinFront: 1.02, roof: 1.62, hood: 0.92, lift: 0.12, wheelR: 0.37, extra: 'bed', halfLen: 1.45 },
  // furgão de entregas: teto alto, laterais fechadas
  van: { rear: -2.4, front: 2.3, belt: 1.1, trunk: 1.1, cabinRear: -2.3, roofRear: -2.32, roofFront: 0.95, cabinFront: 1.55, roof: 2.1, hood: 1.02, lift: 0.1, wheelR: 0.36, extra: 'van', halfLen: 1.45 },
  // táxi: sedã branco com luminoso no teto
  taxi: { rear: -2.2, front: 2.2, belt: 0.95, trunk: 0.92, cabinRear: -1.2, roofRear: -0.82, roofFront: 0.32, cabinFront: 1.05, roof: 1.42, hood: 0.82, lift: 0, wheelR: 0.34, extra: 'taxi', color: 0xf2f2f2 },
};
export const CAR_TYPES = Object.keys(TYPES);

// Lataria + faróis/lanternas numa malha só (1 draw call por carro): as luzes são vértices com aGlow = 1,
// que o shader acende como emissivo (mais forte à noite, brilhando no bloom).
const LIGHT_K = { value: 0.9 };
const BODY_MAT = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, reflectivity: 0.35, combine: THREE.MixOperation });
BODY_MAT.onBeforeCompile = (sh) => {
  sh.uniforms.uLightK = LIGHT_K;
  sh.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvGlow = aGlow;');
  sh.fragmentShader = 'uniform float uLightK;\nvarying float vGlow;\n' + sh.fragmentShader
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vGlow * uLightK;');
};
const BAR = new THREE.BoxGeometry(0.55, 0.14, 0.3);
let WET = 0; // 0 = seco, 1 = chuva forte
export function setWetRoad(v) { WET = v; }
export function setCarEnvMap(tex) { BODY_MAT.envMap = tex; BODY_MAT.needsUpdate = true; }

// Faróis à noite: feixe volumétrico falso (cone translúcido aditivo que some à distância) + mancha de luz
// no asfalto. Materiais globais: um interruptor liga/desliga todos os carros de uma vez (sem custo de luz real).
// Cones e mancha no chão na MESMA malha (aKind 0 = cone, 1 = chão): 1 draw call por carro à noite.
const BEAM_MAT = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uI: { value: 1 } },
  vertexShader: TERRAIN_GLSL + `attribute float aKind; varying vec2 vUv; varying float vK; varying float vFace;
    void main(){
      vUv = uv; vK = aKind;
      vec4 w = modelMatrix * vec4(position, 1.0);
      w.y += terrainH(w.xz); // o cone acompanha a ladeira
      vec4 mv = viewMatrix * w;
      vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); // 1 = de frente, 0 = de raspão
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform float uI; varying vec2 vUv; varying float vK; varying float vFace;
    void main(){
      float d = length(vUv - 0.5) * 2.0;
      // cone: some na ponta e nas bordas (vistas de raspão) — parece poeira iluminada, não um sólido
      float a = vK < 0.5 ? pow(vUv.y, 2.6) * 0.075 * pow(vFace, 1.5) : pow(max(0.0, 1.0 - d), 2.0) * 0.3;
      gl_FragColor = vec4(vec3(1.0, 0.9, 0.68) * a * uI, 1.0);
    }`,
});
BEAM_MAT.visible = false;
/** Liga os faróis (cones + luz no chão) e deixa lanternas/faróis mais fortes (brilham no bloom). */
export function setCarLightsNight(k) {
  const on = k > 0.35;
  BEAM_MAT.visible = on;
  BEAM_MAT.uniforms.uI.value = Math.min(1, k);
  LIGHT_K.value = on ? 2.6 : 0.9;
}
const beamCache = new Map();
function beamGeometry(type) {
  if (beamCache.has(type)) return beamCache.get(type);
  const t = TYPES[type], L = 13, y = t.hood - 0.1;
  const kind = (g, k) => { g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1)); return g; };
  const cone = (x) => kind(new THREE.ConeGeometry(2.4, L, 14, 1, true).rotateX(-Math.PI / 2).rotateX(0.06).translate(x, y - 0.35, t.front + L / 2 - 0.1), 0);
  const out = mergeGeometries([cone(-0.6), cone(0.6), kind(new THREE.PlaneGeometry(4.2, 7.5).rotateX(-Math.PI / 2).translate(0, 0.09, t.front + 5.2), 1)]);
  beamCache.set(type, out);
  return out;
}

function paint(geo, hex, glow = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
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
  if (t.extra === 'spoiler') { // aerofólio na tampa traseira
    parts.push(paint(box(1.6, 0.05, 0.28, 0, t.trunk + 0.2, t.rear + 0.25), 0x151515));
    for (const x of [0.6, -0.6]) parts.push(paint(box(0.06, 0.2, 0.12, x, t.trunk + 0.09, t.rear + 0.25), 0x151515));
    parts.push(paint(box(1.0, 0.05, 0.3, 0, 0.36 + L, t.front + 0.04), 0x151515)); // lábio dianteiro
  }
  if (t.extra === 'bed') { // caçamba com capota, bordas e santo-antônio
    const bl = t.cabinRear - 0.08 - (t.rear + 0.12), bz = (t.cabinRear - 0.08 + t.rear + 0.12) / 2;
    parts.push(paint(box(1.62, 0.03, bl, 0, t.trunk + 0.01, bz), 0x1b1b1b));
    for (const x of [0.86, -0.86]) parts.push(paint(box(0.08, 0.06, bl, x, t.trunk + 0.03, bz), color));
    for (const x of [0.72, -0.72]) parts.push(paint(box(0.06, 0.45, 0.06, x, t.trunk + 0.24, t.cabinRear - 0.15), 0x2a2a2a));
    parts.push(paint(box(1.5, 0.06, 0.06, 0, t.trunk + 0.46, t.cabinRear - 0.15), 0x2a2a2a));
  }
  if (t.extra === 'van') { // laterais fechadas do baú (sem vidro) + frisos das portas traseiras
    const zf = t.roofFront - 0.85, zl = zf - (t.rear + 0.08);
    parts.push(paint(box(1.6, t.roof - t.belt - 0.04, zl, 0, (t.roof + t.belt) / 2 - 0.01, (zf + t.rear + 0.08) / 2), color));
    parts.push(paint(box(0.02, t.roof - 0.35, 0.02, 0, (t.roof - 0.35) / 2 + 0.3, t.rear - 0.02), 0x222222));
  }
  if (t.extra === 'taxi') { // luminoso TÁXI no teto e faixa lateral quadriculada
    parts.push(paint(box(0.72, 0.2, 0.3, 0, t.roof + 0.14, (t.roofRear + t.roofFront) / 2), 0xffd200, 0.6));
    for (const x of [0.912, -0.912]) for (let k = 0; k < 10; k++) parts.push(paint(box(0.012, 0.07, 0.18, x, 0.72 + L + (k % 2) * 0.07, -0.9 + k * 0.18), k % 2 ? 0x111111 : 0xf2f2f2));
  }
  // faróis e lanternas entram na mesma malha (aGlow = 1)
  parts.push(
    paint(box(0.36, 0.12, 0.05, -0.6, t.hood - 0.1, t.front - 0.06), 0xfff2c0, 1), paint(box(0.36, 0.12, 0.05, 0.6, t.hood - 0.1, t.front - 0.06), 0xfff2c0, 1),
    paint(box(0.34, 0.12, 0.05, -0.62, t.trunk - 0.12, t.rear - 0.01), 0xff1a1a, 1), paint(box(0.34, 0.12, 0.05, 0.62, t.trunk - 0.12, t.rear - 0.01), 0xff1a1a, 1),
  );
  const body = mergeGeometries(parts);
  const out = { body, roof: t.roof };
  cache.set(key, out);
  return out;
}

export function makeCarMesh(color, police = false, type = 'sedan') {
  const g = new THREE.Group(), geo = carGeometry(color, type, police);
  const body = new THREE.Mesh(geo.body, BODY_MAT);
  body.castShadow = true; // sombra real do carro (Médio/Alto)
  const beams = new THREE.Mesh(beamGeometry(type), BEAM_MAT);
  beams.renderOrder = 3;
  g.add(body, beams);
  g.userData.body = body;
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
  return carGeometry(0xffffff, type, false).body.attributes.position.count / 3;
}

export class Vehicle {
  constructor(color = 0xc81e1e, police = false, type = 'sedan') {
    this.type = type;
    if (TYPES[type].color && !police) color = TYPES[type].color; // táxi é sempre branco
    this.mesh = makeCarMesh(color, police, type);
    if (TYPES[type].halfLen) this.halfLen = TYPES[type].halfLen; // picape e furgão: cápsula de colisão maior
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

// Física arcade do carro do jogador em PASSO FIXO (120 Hz): a dirigibilidade é a mesma a 30 ou a 144 FPS.
// A dinâmica (aceleração, volante, derrapagem, transferência de peso) roda em sub-passos só com números;
// a colisão com prédios (character controller do Rapier) roda uma vez por quadro com o deslocamento somado.
// Retorna a velocidade do impacto (0 = não bateu).
const STEP = 1 / 120, MAX_STEPS = 10;
export function driveArcade(v, dt, input, phys) {
  const ax = input.axis, hand = input.down('Space');
  // analógico no celular (acelerador e volante proporcionais), teclas no PC
  const thr = ax.active ? Math.max(0, -ax.y * 1.25 - 0.1) : input.down('KeyW', 'ArrowUp') ? 1 : 0;
  const brk = ax.active ? Math.max(0, ax.y * 1.25 - 0.1) : input.down('KeyS', 'ArrowDown') ? 1 : 0;
  const steerIn = ax.active ? -ax.x : (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
  v._acc = (v._acc || 0) + dt;
  let dx = 0, dz = 0, n = 0, yawSum = 0;
  const v0 = v.speed;
  while (v._acc >= STEP && n < MAX_STEPS) {
    // ladeira: inclinação da rua sob o carro (frente − traseira), medida a cada sub-passo
    const px = v.pos.x + dx, pz = v.pos.z + dz, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    v.grade = (heightAt(px + fx * 2, pz + fz * 2) - heightAt(px - fx * 2, pz - fz * 2)) / 4;
    const d = stepCar(v, STEP, thr, brk, steerIn, hand);
    dx += d[0]; dz += d[1]; yawSum += d[2];
    v._acc -= STEP; n++;
  }
  if (n === MAX_STEPS) v._acc = 0; // quadro muito lento: descarta o atraso em vez de acumular
  if (!n) return 0;
  const T = n * STEP;
  // colisão: um movimento só, com o total dos sub-passos
  phys.carBody.setNextKinematicRotation(quatY(v.heading));
  const res = phys.move(phys.carCtrl, phys.carBody, phys.carCollider, { x: dx, y: 0, z: dz }, 0);
  let impact = 0;
  const wl = Math.hypot(dx, dz), ml = Math.hypot(res.moved.x, res.moved.z);
  if (wl > 0.02 && ml < wl * 0.55) { impact = Math.abs(v.speed); v.speed *= -0.25; v.lat *= 0.3; }
  v.pos.set(res.pos.x, 0, res.pos.z);
  v.mesh.rotation.y = v.heading;
  // suspensão visual: mergulha na freada, empina na arrancada e inclina nas curvas
  const longAcc = (v.speed - v0) / T, yawRate = yawSum / T;
  const body = v.mesh.userData.body;
  if (body) {
    const k = Math.min(1, T * 8);
    body.rotation.x += (clamp(-longAcc * 0.0045, -0.05, 0.05) - body.rotation.x) * k;
    body.rotation.z += (clamp(yawRate * Math.abs(v.speed) * 0.0032, -0.06, 0.06) - body.rotation.z) * k;
  }
  return impact;
}

// Um sub-passo da dinâmica. Retorna [dx, dz, dYaw].
function stepCar(v, dt, thr, brk, steerIn, hand) {
  // volante gira aos poucos e volta ao centro sozinho
  v.steer = (v.steer || 0) + (steerIn - (v.steer || 0)) * Math.min(1, (steerIn === 0 ? 7 : 4.5) * dt);
  const steer = v.steer, before = v.speed;
  const MAX = 36, REV = -9;
  if (thr) v.speed += (v.speed < 0 ? 22 : 10 * (1 - v.speed / MAX) + 1) * Math.min(1, thr) * dt;
  if (brk) v.speed -= (v.speed > 0.5 ? 22 : 7) * Math.min(1, brk) * dt;
  if (!thr && !brk) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3 * dt);
  if (hand) v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 8 * dt);
  // gravidade na ladeira: subindo perde velocidade, descendo embala (freio de mão segura o carro parado)
  const g = 9.81 * clamp(v.grade || 0, -0.35, 0.35) * 0.55;
  if (!(hand && Math.abs(v.speed) < 1)) v.speed -= g * dt;
  v.speed = clamp(v.speed, REV, MAX);
  // transferência de peso: freando, o peso vai para a frente (mais aderência para virar);
  // acelerando, vai para trás (a traseira solta mais fácil)
  const acc = (v.speed - before) / dt;
  v.load = (v.load || 0) + (clamp(acc / 18, -1, 1) - (v.load || 0)) * Math.min(1, 6 * dt);
  const grip = clamp(Math.abs(v.speed) / 6, 0, 1) / (1 + Math.abs(v.speed) * 0.025);
  const yawRate = steer * 1.7 * grip * (v.speed < 0 ? -1 : 1) * (hand ? 1.5 : 1) * (1 - 0.22 * v.load) / (1 + Math.abs(v.speed) * 0.012);
  v.heading += yawRate * dt;
  v.lat += yawRate * Math.abs(v.speed) * (hand ? 0.35 : 0.1) * dt; // força centrífuga
  const rearGrip = (hand ? 1.2 : 6) * (1 - 0.55 * WET) * (1 - 0.3 * Math.max(0, v.load));
  v.lat *= Math.exp(-rearGrip * dt); // chuva e acelerador forte: o carro escorrega mais
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = -fz, rz = fx;
  v.vx = fx * v.speed + rx * v.lat;
  v.vz = fz * v.speed + rz * v.lat;
  return [v.vx * dt, v.vz * dt, yawRate * dt];
}
