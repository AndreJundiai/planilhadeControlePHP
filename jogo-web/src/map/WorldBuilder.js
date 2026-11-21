import * as THREE from 'three';

// Extrusão procedural do OSM: prédios (altura por height/building:levels), ruas, calçadas e árvores.
export const ROADW = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, residential: 7.5, unclassified: 7,
  living_street: 6, service: 4.5, pedestrian: 5, footway: 2, path: 1.8, cycleway: 2, steps: 2,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const SPEEDS = { motorway: 25, trunk: 20, primary: 15, secondary: 13, tertiary: 12, residential: 9, unclassified: 9, living_street: 5, service: 6 };
export const uniforms = { uCentro: { value: new THREE.Vector2(0, 0) }, uNight: { value: 0 }, uSky: { value: new THREE.Color(0x9fb8d0) }, uWet: { value: 0.35 } };

const PALETTE = [0xf1e6d0, 0xe8d9b0, 0xf4f1ea, 0xe7b99b, 0xc9dbe0, 0xd6e2c4, 0xbdb7ad, 0xf0c987, 0xe3c1c1, 0xfafafa];
const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const HASH = 'float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n';

function area(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}

// Fachadas modulares: janelas nos andares, térreo conforme a zona (0 casa: porta · 1 comércio: vitrine + toldo ·
// 2 indústria: portão de enrolar) e platibanda escura no topo. binfo = (zona, altura do prédio).
function wallMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = 'attribute vec2 wuv;\nattribute vec2 binfo;\nvarying vec2 vWuv;\nvarying vec2 vB;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvWuv = wuv; vB = binfo;');
    sh.fragmentShader = 'uniform float uNight;\nvarying vec2 vWuv;\nvarying vec2 vB;\n' + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 cell = vWuv / 3.2; vec2 fw = fract(cell);
        float upper = step(3.2, vWuv.y) * step(vWuv.y, vB.y - 0.7);
        float win = step(0.22,fw.x)*step(fw.x,0.78)*step(0.3,fw.y)*step(fw.y,0.82)*step(hh(floor(cell)+vColor.rg*17.0),0.88) * upper;
        vec3 glass = mix(vec3(0.06,0.09,0.13), vec3(0.36,0.46,0.56), hh(floor(cell)+3.1)) * (0.75 + 0.5 * fw.y); // reflexo falso do céu
        vec3 c = diffuseColor.rgb;
        float shop = 0.0;
        if (vWuv.y < 3.2) {
          if (vB.x > 1.5) { // indústria: portão de enrolar
            float cx = mod(vWuv.x, 9.0);
            float gate = step(1.0, cx) * step(cx, 5.5) * step(vWuv.y, 2.9);
            c = mix(c, vec3(0.5, 0.53, 0.56) * (0.85 + 0.15 * step(0.5, fract(vWuv.y * 5.0))), gate);
          } else if (vB.x > 0.5) { // comércio: vitrine + toldo listrado
            float id = floor(vWuv.x / 5.0), cx = mod(vWuv.x, 5.0);
            shop = step(0.35, cx) * step(cx, 4.65) * step(0.3, vWuv.y) * step(vWuv.y, 2.55);
            vec3 inside = vec3(0.16, 0.18, 0.2) + vec3(0.25, 0.2, 0.12) * hh(vec2(id, 9.0));
            c = mix(c, inside, shop);
            float aw = step(2.62, vWuv.y) * step(vWuv.y, 3.05);
            vec3 awc = mix(vec3(0.72, 0.14, 0.1), mix(vec3(0.12, 0.38, 0.7), vec3(0.15, 0.55, 0.25), step(0.66, hh(vec2(id, 4.0)))), step(0.4, hh(vec2(id, 2.0))));
            c = mix(c, awc * (0.82 + 0.18 * step(0.5, fract(vWuv.x * 1.4))), aw);
          } else { // casa: porta + janela do térreo
            float cx = mod(vWuv.x, 8.0);
            float door = step(1.2, cx) * step(cx, 2.2) * step(vWuv.y, 2.15);
            float gw = step(3.6, cx) * step(cx, 5.2) * step(1.0, vWuv.y) * step(vWuv.y, 2.2);
            c = mix(c, vec3(0.36, 0.22, 0.12), door);
            c = mix(c, glass, gw);
            win = max(win, gw);
          }
          c *= 1.0 - 0.3 * (1.0 - step(0.35, vWuv.y)); // rodapé
        }
        c = mix(c, glass, win);
        c *= 1.0 - 0.28 * step(vB.y - 0.45, vWuv.y); // platibanda no topo
        diffuseColor.rgb = c;
        float lit = (win * step(0.45, hh(floor(cell)+7.7)) + shop * 1.4) * uNight;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0,0.75,0.4)*lit*0.6;');
  };
  return m;
}

// Calçadas: concreto com variação; no Centro (até ~900 m da Catedral) vira mosaico português preto e branco em ondas.
function walkMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0x9d9a92, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCentro = uniforms.uCentro;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec2 uCentro;\nvarying vec3 vWp;\n' + HASH + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 cell = floor(vWp.xz * 9.0);                       // pedrinhas de ~11 cm
      float stone = 0.82 + hh(cell) * 0.18;
      diffuseColor.rgb *= 0.92 + hh(floor(vWp.xz * 1.3)) * 0.1; // manchas de concreto
      float centro = 1.0 - smoothstep(700.0, 900.0, distance(vWp.xz, uCentro));
      float wave = step(0.5, fract((vWp.x + sin(vWp.z * 0.55) * 1.4) * 0.28)); // ondas
      vec3 mosaic = mix(vec3(0.08), vec3(0.88, 0.86, 0.82), wave) * stone;
      diffuseColor.rgb = mix(diffuseColor.rgb, mosaic, centro);`);
  };
  return m;
}

function roadMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0x3c3c40, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 wuv;\nattribute float flag;\nvarying vec2 vWuv;\nvarying float vFlag;\nvarying vec3 vWp;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWuv = wuv; vFlag = flag;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.uniforms.uSky = uniforms.uSky;
    sh.uniforms.uWet = uniforms.uWet;
    sh.fragmentShader = 'uniform vec3 uSky;\nuniform float uWet;\nvarying vec2 vWuv;\nvarying float vFlag;\nvarying vec3 vWp;\n' + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.9 + hh(floor(vWp.xz*8.0))*0.12 + hh(floor(vWp.xz*0.6))*0.1;
        if (vWuv.x >= 0.0 && vFlag > 0.5) {
          float d = abs(vWuv.x - 0.5);
          float c = step(d, 0.012) * step(0.45, fract(vWuv.y / 8.0));
          float e = step(0.43, d) * step(d, 0.455);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.62,0.08), c);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), e);
        }
        // poças: manchas suaves onde o asfalto escurece e reflete o céu (mais forte olhando rasante)
        vec2 pc = vWp.xz * 0.12;
        float pn = mix(hh(floor(pc)), hh(floor(pc) + 1.0), 0.5) * 0.6 + hh(floor(vWp.xz * 0.35)) * 0.4;
        float puddle = smoothstep(0.62, 0.78, pn) * uWet;
        diffuseColor.rgb *= 1.0 - puddle * 0.45;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - abs(dot(normalize(-vViewPosition), normal)), 4.0);
        totalEmissiveRadiance += uSky * puddle * (0.12 + 0.6 * fres);`);
  };
  return m;
}

// Materiais e geometrias compartilhados por todos os blocos (shader compilado uma vez só).
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    wall: wallMaterial(),
    wallFar: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    road: roadMaterial(),
    walk: walkMaterial(),
    curb: new THREE.MeshLambertMaterial({ color: 0xc4c0b6, side: THREE.DoubleSide }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    trunkGeo: new THREE.CylinderGeometry(0.12, 0.22, 3, 6),
    crownGeo: new THREE.IcosahedronGeometry(2.1, 1),
    trunk: new THREE.MeshLambertMaterial({ color: 0x5a3d26 }),
    crown: new THREE.MeshLambertMaterial({ color: 0x3a7a2a, flatShading: true }),
  };
  return SHARED;
}

// Constrói um bloco do mapa. `built` guarda os IDs já construídos (um prédio na divisa não aparece duas vezes).
// RUNTIME, em Web Worker (sem travar a tela): calcula a geometria de um bloco do mapa só com números.
// `built` guarda os IDs já construídos (um prédio na divisa não aparece duas vezes).
export function computeWorld(data, proj, built = new Set()) {
  const ids = [];
  const wall = { p: [], n: [], c: [], u: [], b: [] }, roof = { p: [], n: [], c: [] }, road = { p: [], u: [], f: [] }, walk = { p: [] }, curb = { p: [], n: [] };
  const trees = [], polys = [], grid = new Map(), G = 60;
  const col = new THREE.Color();
  let auto = 1, nb = 0;

  const ribbon = (buf, a, b, ox, oz, y, v0, L, mark) => {
    const P = [[a[0] + ox, a[1] + oz, 0, v0], [b[0] + ox, b[1] + oz, 0, v0 + L], [a[0] - ox, a[1] - oz, 1, v0],
      [b[0] + ox, b[1] + oz, 0, v0 + L], [b[0] - ox, b[1] - oz, 1, v0 + L], [a[0] - ox, a[1] - oz, 1, v0]];
    for (const q of P) { buf.p.push(q[0], y, q[1]); if (buf.u) { buf.u.push(q[2], q[3]); buf.f.push(mark); } }
  };

  // Meio-fio: faixa elevada de 14 cm na borda da pista (topo + face voltada para a rua).
  function curbStrip(a, b, nx, nz, w, y) {
    const H = 0.14, W = 0.18;
    const i0 = [a[0] + nx * w, a[1] + nz * w], i1 = [b[0] + nx * w, b[1] + nz * w];
    const o0 = [a[0] + nx * (w + W), a[1] + nz * (w + W)], o1 = [b[0] + nx * (w + W), b[1] + nz * (w + W)];
    for (const q of [i0, i1, o0, i1, o1, o0]) { curb.p.push(q[0], H, q[1]); curb.n.push(0, 1, 0); }
    for (const q of [[i0, y], [i1, y], [i0, H], [i1, y], [i1, H], [i0, H]]) { curb.p.push(q[0][0], q[1], q[0][1]); curb.n.push(-nx, 0, -nz); }
  }

  function building(pts, t, s) {
    pts = pts.slice(0, -1);
    if (pts.length < 3) return;
    let A = area(pts);
    if (A < 0) { pts.reverse(); A = -A; }
    let lv = parseFloat(t['building:levels']) || 0, h = parseFloat(t.height) || 0;
    if (!lv) lv = A < 300 ? 1 + Math.floor(rnd(s) * 2) : 2 + Math.floor(rnd(s) * 4);
    if (!h) h = lv * 3.2 + 0.6;
    col.setHex(PALETTE[Math.floor(rnd(s + 1) * PALETTE.length)]);
    const b = t.building, zone = t._zone === 'industrial' ? 2 : t._zone === 'commercial' || t._zone === 'retail' ? 1 : t.shop || t.amenity || ['retail', 'commercial', 'supermarket', 'kiosk', 'office'].includes(b) ? 1
      : ['industrial', 'warehouse', 'factory', 'shed', 'manufacture', 'hangar'].includes(b) ? 2
      : ['house', 'residential', 'detached', 'apartments', 'terrace', 'semidetached_house'].includes(b) ? 0
      : lv >= 2 && rnd(s + 5) < 0.35 ? 1 : 0;
    if (zone === 2 && !t.height && !t['building:levels']) { h = 6.5 + rnd(s + 9) * 3.5; lv = 2; } // galpão industrial: baixo e largo
    let u = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = dz / L, nz = -dx / L; // normal para fora (polígono anti-horário)
      for (const q of [[ax, 0, az, u, 0], [bx, 0, bz, u + L, 0], [ax, h, az, u, h], [bx, 0, bz, u + L, 0], [bx, h, bz, u + L, h], [ax, h, az, u, h]]) {
        wall.p.push(q[0], q[1], q[2]); wall.n.push(nx, 0, nz); wall.c.push(col.r, col.g, col.b); wall.u.push(q[3], q[4]); wall.b.push(zone, h);
      }
      u += L;
    }
    const rc = new THREE.Color(zone === 2 ? 0xa3aab0 : lv <= 2 ? 0x9c4a32 : 0x8a8a86) // zinco · telha de barro · laje.multiplyScalar(0.8 + rnd(s + 2) * 0.25);
    for (const f of THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])) {
      for (const i of f) { roof.p.push(pts[i][0], h, pts[i][1]); roof.n.push(0, 1, 0); roof.c.push(rc.r, rc.g, rc.b); }
    }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const idx = polys.push(pts) - 1;
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) {
      for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
        const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(idx);
      }
    }
    nb++;
  }

  function roadWay(pts, t, s) {
    const hw = t.highway, w = ROADW[hw] / 2, foot = !DRIVABLE.has(hw);
    const y = foot ? 0.035 : 0.06 + w * 0.002, mark = !foot && w >= 3.5 ? 1 : 0;
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = -dz / L, nz = dx / L;
      ribbon(foot ? walk : road, a, b, nx * w, nz * w, y, dist, L, mark);
      if (!foot && hw !== 'service') {
        ribbon(walk, a, b, nx * (w + 2.6), nz * (w + 2.6), 0.025, dist, L, 0);
        for (const sd of [1, -1]) curbStrip(a, b, nx * sd, nz * sd, w, y);
      }
      if (hw === 'residential' || hw === 'tertiary' || hw === 'secondary') {
        for (let d = 6 + rnd(s + i) * 8; d < L; d += 14 + rnd(s + d) * 8) {
          const side = rnd(s + d * 3) < 0.5 ? 1 : -1;
          if (rnd(s + d * 5) < 0.5) trees.push([a[0] + (dx / L) * d + nx * (w + 1.8) * side, a[1] + (dz / L) * d + nz * (w + 1.8) * side]);
        }
      }
      dist += L;
    }
    if (!foot) {
      for (const p of pts) {
        for (let k = 0; k < 10; k++) {
          const a1 = (k / 10) * Math.PI * 2, a2 = ((k + 1) / 10) * Math.PI * 2;
          for (const q of [[p[0], p[1]], [p[0] + Math.cos(a2) * w, p[1] + Math.sin(a2) * w], [p[0] + Math.cos(a1) * w, p[1] + Math.sin(a1) * w]]) {
            road.p.push(q[0], y - 0.004, q[1]); road.u.push(-1, 0); road.f.push(0);
          }
        }
      }
    }
  }

  for (const el of data.elements) {
    const t = el.tags || {};
    const uid = el.type[0] + el.id;
    if (built.has(uid)) continue;
    const s = typeof el.id === 'number' ? el.id % 100000 : auto++;
    if (el.type === 'relation' && t.building && el.members) {
      // prédios grandes desenhados como "relação" (multipolígono): usa os contornos externos
      built.add(uid); ids.push(uid);
      for (const m of el.members) {
        if (m.role !== 'outer' || !m.geometry) continue;
        const pts = m.geometry.filter(Boolean).map((g) => proj.toXZ(g.lon, g.lat));
        if (pts.length >= 4) building(pts, t, s + pts.length);
      }
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const pts = el.geometry.filter(Boolean).map((g) => proj.toXZ(g.lon, g.lat));
    if (pts.length < 2) continue;
    if (t.building && pts.length >= 4) { built.add(uid); ids.push(uid); building(pts, t, s); }
    else if (t.highway && ROADW[t.highway]) { built.add(uid); ids.push(uid); roadWay(pts, t, s); }
  }

  const insideBuilding = (x, z) => {
    const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G));
    if (!l) return false;
    for (const i of l) {
      const P = polys[i];
      let c = false;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
        if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) c = !c;
      }
      if (c) return true;
    }
    return false;
  };

  const okTrees = trees.filter(([x, z]) => !insideBuilding(x, z));
  const f32 = (arr) => (arr ? new Float32Array(arr) : null);
  const pack = (b) => ({ p: f32(b.p), n: f32(b.n), c: f32(b.c), u: f32(b.u), f: f32(b.f), b: f32(b.b) });
  return {
    wall: pack(wall), roof: pack(roof), road: pack(road), walk: pack(walk), curb: pack(curb),
    trees: new Float32Array(okTrees.flat()), polys: polys.map((P) => new Float32Array(P.flat())), ids, stats: { buildings: nb, trees: okTrees.length },
  };
}

// RUNTIME, thread principal (rápido): transforma os números calculados em malhas e no teste "dentro de prédio".
export function assembleWorld(r) {
  const M = shared(), G = 60, grid = new Map();
  const polys = r.polys.map((F) => { const P = []; for (let i = 0; i < F.length; i += 2) P.push([F[i], F[i + 1]]); return P; });
  polys.forEach((P, idx) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of P) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(idx);
    }
  });
  const insideBuilding = (x, z) => {
    const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G));
    if (!l) return false;
    for (const i of l) {
      const P = polys[i];
      let c = false;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) c = !c;
      if (c) return true;
    }
    return false;
  };
  const group = new THREE.Group();
  const mesh = (b, mat, cast, lodFar = null) => {
    if (!b.p || !b.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.p, 3));
    if (b.n) g.setAttribute('normal', new THREE.BufferAttribute(b.n, 3));
    else { const n = new Float32Array(b.p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
    if (b.c) g.setAttribute('color', new THREE.BufferAttribute(b.c, 3));
    if (b.u) g.setAttribute('wuv', new THREE.BufferAttribute(b.u, 2));
    if (b.f) g.setAttribute('flag', new THREE.BufferAttribute(b.f, 1));
    if (b.b) g.setAttribute('binfo', new THREE.BufferAttribute(b.b, 2));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast; // só os prédios projetam sombra dinâmica (e só no nível Alto)
    m.receiveShadow = true;
    if (lodFar) m.userData.lod = { near: mat, far: lodFar };
    group.add(m);
    return m;
  };
  mesh(r.walk, M.walk, false);
  mesh(r.curb, M.curb, false);
  mesh(r.road, M.road, false);
  mesh(r.wall, M.wall, true, M.wallFar); // LOD: longe, parede sem o cálculo de janelas
  mesh(r.roof, M.roof, true);
  const nTrees = r.trees.length / 2;
  if (nTrees) {
    const trunk = new THREE.InstancedMesh(M.trunkGeo, M.trunk, nTrees);
    const crown = new THREE.InstancedMesh(M.crownGeo, M.crown, nTrees);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < nTrees; i++) {
      const x = r.trees[i * 2], z = r.trees[i * 2 + 1], s = 0.75 + rnd(x * 3.1 + z) * 0.6;
      trunk.setMatrixAt(i, m4.compose(v.set(x, 1.5 * s, z), q, sc.set(s, s, s)));
      crown.setMatrixAt(i, m4.compose(v.set(x, 4.0 * s, z), q, sc.set(s, s * 0.85, s)));
    }
    trunk.castShadow = crown.castShadow = true;
    group.add(trunk, crown);
  }
  return { group, ids: r.ids, insideBuilding, wallVerts: r.wall.p || new Float32Array(0), wallIdx: Uint32Array.from({ length: (r.wall.p?.length || 0) / 3 }, (_, i) => i), stats: r.stats };
}

// Pré-compila os shaders de LOD na tela de título (evita um engasgo na 1ª troca de material no jogo).
export function warmupMaterials(renderer, scene, camera) {
  const M = shared(), g = new THREE.BoxGeometry(0.01, 0.01, 0.01), probes = [M.wall, M.wallFar, M.roof, M.road, M.walk, M.curb].map((m) => new THREE.Mesh(g, m));
  probes.forEach((p) => { p.position.set(camera.position.x, -50, camera.position.z); scene.add(p); });
  renderer.compile(scene, camera);
  probes.forEach((p) => scene.remove(p));
}

// Versão síncrona (sem Worker): mesmo resultado, numa tacada só.
export const buildWorld = (data, proj, built) => assembleWorld(computeWorld(data, proj, built));

// Libera a memória de um bloco descarregado.
export function disposeWorld(w) {
  const M = shared();
  w.group.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    else if (o.geometry && o.geometry !== M.trunkGeo && o.geometry !== M.crownGeo) o.geometry.dispose();
  });
}

// Chão com variação de cor (grama/terra) feito por shader, sem textura para baixar.
export function groundMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0x6b6a48 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWp;\n' + HASH + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float n1 = hh(floor(vWp.xz * 0.08)), n2 = hh(floor(vWp.xz * 1.5)), n3 = hh(floor(vWp.xz * 6.0));
      vec3 dirt = vec3(0.42, 0.36, 0.27);
      diffuseColor.rgb = mix(diffuseColor.rgb, dirt, smoothstep(0.6, 1.0, n1) * 0.6);
      diffuseColor.rgb *= 0.85 + n2 * 0.15 + n3 * 0.08;`);
  };
  return m;
}
