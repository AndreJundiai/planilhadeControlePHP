import * as THREE from 'three';
import { ROADW, DRIVABLE } from './WorldBuilder.js';

/**
 * Street furniture generated from the OSM road network of one map chunk:
 * lamp posts (glow at night + light pool on the ground), traffic lights at the bigger crossings
 * (red/yellow/green cycle), zebra crossings at every crossing, orange bins and red hydrants.
 * Everything static is merged into one mesh per chunk; lamp heads, light pools, crossings and
 * signal lenses are one mesh each → ~5 draw calls per chunk.
 */
const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// IDs do OSM são números, mas os do plano B e da cidade de teste são texto: transforma qualquer um em número
const num = (id) => { if (typeof id === 'number') return id; let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const cyl = (rt, rb, h, x, y, z, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y, z);
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

// Templates: local +Z points towards the road (lamp arm, signal face).
const T = {
  pole: [colored(cyl(0.07, 0.1, 7, 0, 3.5, 0), 0x5a5f66), colored(box(0.06, 0.06, 1.7, 0, 6.95, 0.85), 0x5a5f66)],
  lampHead: [colored(box(0.5, 0.1, 0.26, 0, 6.88, 1.62), 0xffffff)],
  bin: [colored(cyl(0.24, 0.21, 0.85, 0, 0.43, 0, 10), 0xe8731a), colored(cyl(0.26, 0.26, 0.05, 0, 0.88, 0, 10), 0x3a3a3a), colored(cyl(0.04, 0.04, 0.9, 0, 0.45, -0.3), 0x555555)],
  hydrant: [colored(cyl(0.11, 0.13, 0.55, 0, 0.28, 0, 10), 0xc0392b), colored(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.55, 0), 0xc0392b),
    colored(cyl(0.05, 0.05, 0.34, 0, 0.38, 0, 8).rotateZ(Math.PI / 2), 0xd4ac0d)],
  tlPole: [colored(cyl(0.07, 0.08, 3.4, 0, 1.7, 0), 0x2b2f33), colored(box(0.34, 0.98, 0.24, 0, 3.0, 0.02), 0x1a1a1a), colored(box(0.4, 1.04, 0.02, 0, 3.0, -0.11), 0xd8b400)],
  lens: [0, 1, 2].map((k) => new THREE.SphereGeometry(0.085, 10, 6).translate(0, 3.3 - k * 0.3, 0.14).toNonIndexed()), // sem índice: o append copia vértice a vértice
};
const LENS_ON = [new THREE.Color(0xff2a1a), new THREE.Color(0xffb000), new THREE.Color(0x30ff6a)]; // vermelho, amarelo, verde
const LENS_OFF = [new THREE.Color(0x3a0806), new THREE.Color(0x3a2a00), new THREE.Color(0x06301a)];

// brilho redondo e suave da luz do poste no chão (degradê radial)
function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const MAT = {
  props: new THREE.MeshLambertMaterial({ vertexColors: true }),
  lamp: new THREE.MeshBasicMaterial({ color: 0x9a9a9a, toneMapped: false }),
  pool: new THREE.MeshBasicMaterial({ map: typeof document !== 'undefined' ? poolTexture() : null, color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  paint: new THREE.MeshLambertMaterial({ color: 0xe8e8e2, polygonOffset: true, polygonOffsetFactor: -2 }),
  lens: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  wire: new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.75 }),
};
let NIGHT = false;
export function setFurnitureNight(on) { NIGHT = on; MAT.lamp.color.set(on ? 0xfff0c8 : 0x9a9a9a); }

// Traffic-light cycle (s): green 9, yellow 2, red 11 — phase 1 is offset by half a cycle.
const CYCLE = 22;
export function signalState(phase, time) {
  const t = (time + phase * (CYCLE / 2)) % CYCLE;
  return t < 9 ? 2 : t < 11 ? 1 : 0; // 2 verde, 1 amarelo, 0 vermelho
}

const lightSets = new Set();
export function updateTrafficLights(time) {
  for (const set of lightSets) {
    if (!set.mesh.visible) continue;
    const a = set.attr.array;
    for (const L of set.lights) {
      const s = signalState(L.phase, time);
      if (s === L.last) continue;
      L.last = s;
      for (let k = 0; k < 3; k++) {
        const c = k === s ? LENS_ON[k] : LENS_OFF[k]; // lente 0 = vermelho (topo), 1 = amarelo, 2 = verde
        for (let i = L.start[k]; i < L.start[k] + L.count; i++) c.toArray(a, i * 3);
      }
      set.attr.needsUpdate = true;
    }
  }
}

// Copia um modelo (template) girado em Y e transladado para o buffer do bloco.
// Rápido de propósito: sem Vector3/Matrix por vértice (era o maior custo de montar um bloco, ~45 ms).
const flatCache = new WeakMap();
function flat(parts) {
  let f = flatCache.get(parts);
  if (!f) {
    f = parts.map((g) => ({ p: g.attributes.position.array, n: g.attributes.normal.array, c: g.attributes.color?.array || null, count: g.attributes.position.count }));
    flatCache.set(parts, f);
  }
  return f;
}
function append(buf, parts, m) {
  const { x: tx, z: tz, c, s } = m;
  for (const g of flat(parts)) {
    const P = g.p, N = g.n, C = g.c, bp = buf.p, bn = buf.n, bc = buf.c;
    for (let i = 0, k = 0; i < g.count; i++, k += 3) {
      const x = P[k], y = P[k + 1], z = P[k + 2];
      bp.push(c * x + s * z + tx, y, -s * x + c * z + tz);
      const nx = N[k], ny = N[k + 1], nz = N[k + 2];
      bn.push(c * nx + s * nz, ny, -s * nx + c * nz);
      if (bc) { if (C) bc.push(C[k], C[k + 1], C[k + 2]); else bc.push(0, 0, 0); }
    }
  }
}
// giro em Y (h) + posição: é a única transformação que o mobiliário usa
const place = (x, z, h) => ({ x, z, c: Math.cos(h), s: Math.sin(h) });

function toMesh(buf, mat) {
  if (!buf.p.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
  if (buf.c) g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
  if (buf.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  return new THREE.Mesh(g, mat);
}

/**
 * @param data   OSM elements of the chunk
 * @param builtIds ways built by THIS chunk (avoids duplicates on chunk borders)
 * @param placed  global Set of crossing node ids already decorated
 * @param inBounds (x,z) → bool: crossing belongs to this chunk
 */
export function computeFurniture(data, proj, builtIds, placed, inBounds, insideBuilding) {
  const wires = []; // fiação aérea: segmentos entre postes vizinhos do mesmo lado
  const lampPos = [], props = { p: [], n: [], c: [] }, lamps = { p: [], n: [] }, pools = { p: [], n: [], uv: [] }, paint = { p: [], n: [] }, lens = { p: [], n: [], c: [] };
  const lights = [], myNodes = [];
  const inc = new Map(), pos = new Map();
  const own = new Set(builtIds);

  for (const el of data.elements) {
    const hw = el.tags?.highway;
    if (el.type !== 'way' || !DRIVABLE.has(hw) || !el.geometry || !el.nodes) continue;
    const pts = el.geometry.map((g) => (g ? proj.toXZ(g.lon, g.lat) : null)), w = ROADW[hw] / 2;
    // cruzamentos: cada nó guarda as direções das ruas que saem dele
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i]) continue;
      pos.set(el.nodes[i], pts[i]);
      for (const j of [i - 1, i + 1]) {
        if (!pts[j]) continue;
        const dx = pts[j][0] - pts[i][0], dz = pts[j][1] - pts[i][1], L = Math.hypot(dx, dz);
        if (L > 0.5) (inc.get(el.nodes[i]) || inc.set(el.nodes[i], []).get(el.nodes[i])).push({ dx: dx / L, dz: dz / L, w, big: w >= 4.5, L });
      }
    }
    if (!own.has('w' + el.id) || hw === 'service') continue;
    // postes, lixeiras e hidrantes ao longo da rua
    const lastPole = {};
    let acc = rnd(num(el.nodes[0]) % 9973) * 20, side = 1, bin = 30 + rnd(num(el.id) % 991) * 40, hyd = 60 + rnd(num(el.id) % 997) * 60;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!a || !b) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.5) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (let d = 0; d < L; d += 1) {
        const x = a[0] + ux * d, z = a[1] + uz * d;
        if ((acc -= 1) <= 0) {
          acc = 30;
          side = -side;
          const px = x + nx * (w + 2.0) * side, pz = z + nz * (w + 2.0) * side;
          if (!insideBuilding(px, pz)) {
            const h = Math.atan2(-nx * side, -nz * side); // braço aponta para a rua
            append(props, T.pole, place(px, pz, h));
            const key = side > 0 ? 'L' : 'R';
            if (lastPole[key]) wires.push(lastPole[key][0], 6.4, lastPole[key][1], px, 6.4, pz);
            lastPole[key] = [px, pz];
            append(lamps, T.lampHead, place(px, pz, h));
            const cx = px - nx * side * 1.6, cz = pz - nz * side * 1.6;
            lampPos.push(cx, cz); // ponto embaixo da luminária (luz real noturna perto do jogador)
            const R = 6.5, Q = [[-R, -R, 0, 0], [R, -R, 1, 0], [R, R, 1, 1], [-R, -R, 0, 0], [R, R, 1, 1], [-R, R, 0, 1]];
            for (const [ox, oz, u, v] of Q) { pools.p.push(cx + ox, 0.09, cz + oz); pools.n.push(0, 1, 0); pools.uv.push(u, v); }
          }
        }
        if ((bin -= 1) <= 0) {
          bin = 55 + rnd(x * 7 + z) * 40;
          const bx = x - nx * (w + 2.25) * side, bz = z - nz * (w + 2.25) * side;
          if (!insideBuilding(bx, bz)) append(props, T.bin, place(bx, bz, 0));
        }
        if ((hyd -= 1) <= 0) {
          hyd = 100 + rnd(x + z * 3) * 60;
          const hx = x + nx * (w + 0.55), hz = z + nz * (w + 0.55);
          if (!insideBuilding(hx, hz)) append(props, T.hydrant, place(hx, hz, Math.atan2(nx, nz)));
        }
      }
    }
  }

  // faixas de pedestre e semáforos nos cruzamentos (3+ ruas)
  for (const [id, dirs] of inc) {
    if (dirs.length < 3 || placed.has(id)) continue;
    const [nx0, nz0] = pos.get(id);
    if (!inBounds(nx0, nz0)) continue;
    placed.add(id);
    myNodes.push(id);
    const R = Math.max(...dirs.map((d) => d.w)) + 0.6;
    const signals = dirs.some((d) => d.big);
    for (const d of dirs) {
      if (d.L < R + 4) continue; // trecho curto demais
      const px = -d.dz, pz = d.dx; // perpendicular
      const cx = nx0 + d.dx * (R + 1.6), cz = nz0 + d.dz * (R + 1.6);
      for (let o = -d.w + 0.5; o <= d.w - 0.4; o += 1.0) { // listras de 0,5 m, paralelas à rua
        const sx = cx + px * o, sz = cz + pz * o, hx = px * 0.25, hz = pz * 0.25, lx = d.dx * 1.5, lz = d.dz * 1.5, y = 0.085;
        const A = [sx - hx - lx, sz - hz - lz], B = [sx + hx - lx, sz + hz - lz], C = [sx + hx + lx, sz + hz + lz], D = [sx - hx + lx, sz - hz + lz];
        for (const q of [A, B, C, A, C, D]) { paint.p.push(q[0], y, q[1]); paint.n.push(0, 1, 0); }
      }
      if (!signals) continue;
      // semáforo no canto direito de quem chega, virado para ele
      const lx = nx0 + d.dx * (R + 3.4) + d.dz * (d.w + 1.0), lz = nz0 + d.dz * (R + 3.4) - d.dx * (d.w + 1.0);
      if (insideBuilding(lx, lz)) continue;
      const h = Math.atan2(d.dx, d.dz), m = place(lx, lz, h);
      append(props, T.tlPole, m);
      const ang = ((Math.atan2(d.dz, d.dx) % Math.PI) + Math.PI) % Math.PI;
      const L = { phase: Math.round(ang / (Math.PI / 2)) % 2, start: [], count: T.lens[0].attributes.position.count, last: -1, x: lx, z: lz, h };
      for (let k = 0; k < 3; k++) { L.start.push(lens.p.length / 3); append(lens, [T.lens[k]], m); }
      lights.push(L);
    }
  }

  // só números (vai e volta do Web Worker sem cópia)
  const f32 = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, new Float32Array(v)]));
  return { props: f32(props), lamps: f32(lamps), pools: f32(pools), paint: f32(paint), lens: f32(lens), wires: new Float32Array(wires), lights, myNodes, lampPos };
}

/** Thread principal: transforma os números do mobiliário em malhas (rápido). */
export function assembleFurniture(f) {
  const { props, lamps, pools, paint, lens, wires, lights, myNodes, lampPos } = f;
  const group = new THREE.Group();
  const add = (m, extra) => { if (m) { Object.assign(m, extra); group.add(m); } return m; };
  add(toMesh(props, MAT.props), { castShadow: true, receiveShadow: true }); // postes, semáforos e lixeiras projetam sombra
  add(toMesh(lamps, MAT.lamp));
  const poolMesh = add(toMesh(pools, MAT.pool), { renderOrder: 2 });
  if (poolMesh) poolMesh.visible = NIGHT;
  add(toMesh(paint, MAT.paint), { receiveShadow: true });
  const lensMesh = add(toMesh(lens, MAT.lens));
  if (wires.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    group.add(new THREE.LineSegments(wg, MAT.wire));
  }
  let set = null;
  if (lensMesh) {
    set = { mesh: lensMesh, attr: lensMesh.geometry.attributes.color, lights };
    lightSets.add(set);
  }
  return { group, set, nodes: myNodes, lights, lamps: lampPos };
}

/** Versão síncrona (sem Worker). */
export const buildFurniture = (...a) => assembleFurniture(computeFurniture(...a));

export function disposeFurniture(f, placed) {
  if (f.set) lightSets.delete(f.set);
  for (const id of f.nodes) placed.delete(id);
  f.group.traverse((o) => o.geometry?.dispose());
}
