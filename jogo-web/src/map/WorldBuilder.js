import * as THREE from 'three';
import { asphaltTexture, concreteTexture, plasterTexture, brickTexture, windowLightTexture, roofTileTexture, parkingTexture, grassTexture, railTexture } from '../render/ProceduralTextures.js';

// Extrusão procedural do OSM: prédios (altura por height/building:levels), ruas, calçadas, árvores,
// parques, lagos, estacionamentos, trilhos e bairros de casas com telhado de telha, muro e portão.
export const ROADW = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, residential: 7.5, unclassified: 7,
  living_street: 6, service: 4.5, pedestrian: 5, footway: 2, path: 1.8, cycleway: 2, steps: 2,
  motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
export const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const SPEEDS = { motorway: 25, trunk: 20, primary: 15, secondary: 13, tertiary: 12, residential: 9, unclassified: 9, living_street: 5, service: 6 };
export const uniforms = { uCentro: { value: new THREE.Vector2(0, 0) }, uNight: { value: 0 }, uSky: { value: new THREE.Color(0x9fb8d0) }, uWet: { value: 0.35 }, uTime: { value: 0 } };

// Zonas da fachada (binfo.x): o shader desenha cada uma de um jeito
export const Z = { CASA: 0, COMERCIO: 1, INDUSTRIA: 2, TIJOLO: 3, VIDRO: 4, IGREJA: 5, MURO: 6, PORTAO: 7 };
const BURY = -2; // paredes descem 2 m abaixo do chão: numa ladeira, o lado de baixo não fica flutuando
const AVENIDA = new Set(['primary', 'trunk', 'motorway', 'secondary']);
const BAIRRO = new Set(['residential', 'living_street', 'unclassified']);

const PALETTE = [0xf1e6d0, 0xe8d9b0, 0xf4f1ea, 0xe7b99b, 0xc9dbe0, 0xd6e2c4, 0xbdb7ad, 0xf0c987, 0xe3c1c1, 0xfafafa];
const HOUSE = [0xf3e3c3, 0xf6d7b0, 0xe9eef0, 0xd9e8cf, 0xf2c9a8, 0xfff4dc, 0xe2d4f0, 0xcfe3ef, 0xf7e08f, 0xe8b9a3];
const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const HASH = 'float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n';
// Coordenada de textura pelo chão (x,z do mundo): ruas, calçadas, parques e estacionamentos repetem sem emenda.
const WORLD_UV = '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (mapTransform * vec3((modelMatrix * vec4(position, 1.0)).xz, 1.0)).xy;\n#endif';

function area(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
function inPoly(x, z, P) {
  let c = false;
  for (let a = 0, b = P.length - 1; a < P.length; b = a++) if ((P[a][1] > z) !== (P[b][1] > z) && x < ((P[b][0] - P[a][0]) * (z - P[a][1])) / (P[b][1] - P[a][1]) + P[a][0]) c = !c;
  return c;
}
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
function convex(P) {
  let sign = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], c = P[(i + 2) % P.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) continue;
    if (sign && Math.sign(cr) !== sign) return false;
    sign = Math.sign(cr);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// MATERIAIS (thread principal). Texturas de Canvas + detalhes no shader.
// ---------------------------------------------------------------------------------------------

// Fachadas: reboco texturizado (map) × cor do prédio; tijolo aparente; pele de vidro; igreja; muros e portões.
// Janelas nos andares e térreo conforme a zona. emissiveMap = mapa de luz das janelas (acende com a noite).
function wallMaterial(far = false) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: plasterTexture() });
  if (far) return m;
  m.emissiveMap = windowLightTexture();
  m.emissive.set(0x000000); // a luz é somada no shader (só onde há janela)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uniforms.uNight;
    sh.uniforms.uBrick = { value: brickTexture() };
    sh.vertexShader = 'attribute vec2 binfo;\nvarying vec2 vWuv;\nvarying vec2 vB;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvWuv = uv; vB = binfo;');
    sh.fragmentShader = 'uniform float uNight;\nuniform sampler2D uBrick;\nvarying vec2 vWuv;\nvarying vec2 vB;\n' + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float zn = floor(vB.x + 0.5);
        vec2 cell = vWuv / 3.2; vec2 fw = fract(cell);
        float upper = step(3.2, vWuv.y) * step(vWuv.y, vB.y - 0.7);
        float win = step(0.22,fw.x)*step(fw.x,0.78)*step(0.3,fw.y)*step(fw.y,0.82)*step(hh(floor(cell)+vColor.rg*17.0),0.88) * upper;
        vec3 glass = mix(vec3(0.06,0.09,0.13), vec3(0.36,0.46,0.56), hh(floor(cell)+3.1)) * (0.75 + 0.5 * fw.y); // reflexo falso do céu
        vec3 c = diffuseColor.rgb;
        float shop = 0.0, holy = 0.0, curtain = 0.0;
        if (zn > 2.5 && zn < 3.5) c = texture2D(uBrick, vWuv / 3.2).rgb * (0.85 + 0.15 * vColor.r); // tijolo aparente
        if (zn > 5.5) { // muro (reboco + rufo escuro no topo) ou portão de chapa
          if (zn > 6.5) c = vec3(0.23, 0.25, 0.28) * (0.75 + 0.25 * step(0.5, fract(vWuv.x * 5.0)));
          c *= 1.0 - 0.35 * step(vB.y - 0.1, vWuv.y);
          win = 0.0;
        } else if (zn > 3.5 && zn < 4.5) { // pele de vidro (Paço, escritórios)
          float mull = clamp(step(0.93, fract(vWuv.x / 1.6)) + step(0.9, fract(vWuv.y / 3.2)), 0.0, 1.0);
          vec3 gc = mix(vec3(0.1, 0.2, 0.24), vec3(0.42, 0.58, 0.66), hh(floor(cell) + 5.3) * 0.5 + fw.y * 0.4);
          c = mix(gc, vec3(0.22, 0.24, 0.26), mull);
          curtain = (1.0 - mull) * step(hh(floor(cell) + 9.1), 0.6);
          win = 0.0;
        } else if (zn > 4.5) { // igreja: janelas altas de vitral
          float cx = mod(vWuv.x, 4.5);
          holy = step(1.6, cx) * step(cx, 2.9) * step(2.4, vWuv.y) * step(vWuv.y, 7.5 + 0.6 * (1.0 - abs(cx - 2.25) / 0.65));
          vec3 vit = mix(vec3(0.15, 0.2, 0.55), vec3(0.6, 0.12, 0.12), step(0.5, fract(vWuv.y * 1.3 + cx)));
          c = mix(c, vit, holy);
          win = 0.0;
        } else if (vWuv.y < 3.2) {
          if (zn > 1.5) { // indústria: portão de enrolar
            float cx = mod(vWuv.x, 9.0);
            float gate = step(1.0, cx) * step(cx, 5.5) * step(vWuv.y, 2.9);
            c = mix(c, vec3(0.5, 0.53, 0.56) * (0.85 + 0.15 * step(0.5, fract(vWuv.y * 5.0))), gate);
          } else if (zn > 0.5) { // comércio: vitrine + toldo listrado
            float id = floor(vWuv.x / 5.0), cx = mod(vWuv.x, 5.0);
            shop = step(0.35, cx) * step(cx, 4.65) * step(0.3, vWuv.y) * step(vWuv.y, 2.55);
            vec3 inside = vec3(0.16, 0.18, 0.2) + vec3(0.25, 0.2, 0.12) * hh(vec2(id, 9.0));
            c = mix(c, inside, shop);
            float aw = step(2.62, vWuv.y) * step(vWuv.y, 3.05);
            vec3 awc = mix(vec3(0.72, 0.14, 0.1), mix(vec3(0.12, 0.38, 0.7), vec3(0.15, 0.55, 0.25), step(0.66, hh(vec2(id, 4.0)))), step(0.4, hh(vec2(id, 2.0))));
            c = mix(c, awc * (0.82 + 0.18 * step(0.5, fract(vWuv.x * 1.4))), aw);
          } else { // casa: porta, janela e portão de garagem
            float cx = mod(vWuv.x, 9.0);
            float door = step(1.2, cx) * step(cx, 2.2) * step(vWuv.y, 2.15);
            float gw = step(3.2, cx) * step(cx, 4.8) * step(1.0, vWuv.y) * step(vWuv.y, 2.2);
            float gar = step(5.6, cx) * step(cx, 8.4) * step(vWuv.y, 2.4) * step(0.45, hh(vec2(floor(vWuv.x / 9.0), vColor.g * 13.0)));
            c = mix(c, vec3(0.36, 0.22, 0.12), door);
            c = mix(c, glass, gw);
            c = mix(c, vec3(0.62, 0.62, 0.6) * (0.8 + 0.2 * step(0.5, fract(vWuv.y * 4.0))), gar);
            win = max(win, gw);
          }
          c *= 1.0 - 0.3 * (1.0 - step(0.35, vWuv.y)); // rodapé
        }
        c = mix(c, glass, win);
        if (zn < 3.5) c *= 1.0 - 0.28 * step(vB.y - 0.45, vWuv.y); // platibanda no topo
        diffuseColor.rgb = c;
        vec3 roomLight = texture2D(emissiveMap, (floor(cell) + 0.5) / 16.0).rgb;
        vec3 lit = (roomLight * (win + curtain * 0.8) + vec3(1.0, 0.8, 0.5) * shop * 0.7 + vec3(1.0, 0.75, 0.45) * holy * 0.5) * uNight;`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lit * 0.75;');
  };
  return m;
}

// Calçadas: placas de concreto (textura) e, no Centro (até ~900 m da Catedral), mosaico português em ondas.
function walkMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, map: concreteTexture() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCentro = uniforms.uCentro;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <uv_vertex>', WORLD_UV)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform vec2 uCentro;\nvarying vec3 vWp;\n' + HASH + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 cell = floor(vWp.xz * 9.0);                       // pedrinhas de ~11 cm
      float stone = 0.82 + hh(cell) * 0.18;
      float centro = 1.0 - smoothstep(700.0, 900.0, distance(vWp.xz, uCentro));
      float wave = step(0.5, fract((vWp.x + sin(vWp.z * 0.55) * 1.4) * 0.28)); // ondas
      vec3 mosaic = mix(vec3(0.08), vec3(0.88, 0.86, 0.82), wave) * stone;
      diffuseColor.rgb = mix(diffuseColor.rgb, mosaic, centro);`);
  };
  return m;
}

// Asfalto (textura de Canvas pelo chão) + faixas pintadas com desgaste e poças que refletem o céu.
// flag 1 = rua (eixo amarelo tracejado) · flag 2 = avenida (eixo amarelo duplo contínuo + faixas brancas tracejadas).
function roadMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xe0e0e0, side: THREE.DoubleSide, map: asphaltTexture() });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 wuv;\nattribute float flag;\nvarying vec2 vWuv;\nvarying float vFlag;\nvarying vec3 vWp;\n' + sh.vertexShader
      .replace('#include <uv_vertex>', WORLD_UV + '\nvWuv = wuv; vFlag = flag;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.uniforms.uSky = uniforms.uSky;
    sh.uniforms.uWet = uniforms.uWet;
    sh.fragmentShader = 'uniform vec3 uSky;\nuniform float uWet;\nvarying vec2 vWuv;\nvarying float vFlag;\nvarying vec3 vWp;\n' + HASH + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= 0.94 + hh(floor(vWp.xz*0.6))*0.08;
        if (vWuv.x >= 0.0 && vFlag > 0.5) {
          float wear = step(0.22, hh(floor(vWp.xz * 7.0))) * (0.55 + 0.45 * hh(floor(vWp.xz * 1.3))); // tinta gasta
          float d = abs(vWuv.x - 0.5);
          float c, lane = 0.0;
          if (vFlag > 1.5) {
            c = step(abs(d - 0.016), 0.006);                               // eixo amarelo duplo contínuo
            lane = step(abs(d - 0.25), 0.006) * step(0.5, fract(vWuv.y / 6.0)); // divisória branca tracejada
          } else c = step(d, 0.012) * step(0.45, fract(vWuv.y / 8.0));
          float e = step(0.43, d) * step(d, 0.452);                        // bordas brancas contínuas
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85,0.62,0.08), c * wear);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82), max(e, lane) * wear);
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

// Material com textura amarrada ao chão (x,z do mundo).
function groundTex(tex, color = 0xffffff) {
  const m = new THREE.MeshLambertMaterial({ color, map: tex, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', WORLD_UV); };
  return m;
}

// Lago: espelho d'água que reflete o céu (environment map do céu) com ondinhas animadas.
function waterMaterial() {
  const m = new THREE.MeshPhongMaterial({ color: 0x1f3d47, specular: 0xaabbcc, shininess: 140, reflectivity: 0.7, combine: THREE.MixOperation, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'varying vec3 vWp2;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvWp2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime;\nvarying vec3 vWp2;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec2 q = vWp2.xz;
      normal = normalize(normal + 0.06 * vec3(sin(q.x * 1.7 + uTime * 1.3) + sin(q.y * 2.3 - uTime), 0.0, cos(q.y * 1.9 + uTime * 1.1) + sin(q.x * 2.9 + uTime * 0.7)));`);
  };
  return m;
}

// Materiais e geometrias compartilhados por todos os blocos (shader compilado uma vez só).
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const tile = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: roofTileTexture() });
  SHARED = {
    wall: wallMaterial(),
    wallFar: wallMaterial(true),
    road: roadMaterial(),
    walk: walkMaterial(),
    curb: new THREE.MeshLambertMaterial({ color: 0xc4c0b6, side: THREE.DoubleSide }),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    tile,
    park: groundTex(grassTexture()),
    lot: groundTex(parkingTexture()),
    water: waterMaterial(),
    rail: new THREE.MeshLambertMaterial({ map: railTexture(), side: THREE.DoubleSide }),
    trunkGeo: new THREE.CylinderGeometry(0.12, 0.22, 3, 6),
    crownGeo: new THREE.IcosahedronGeometry(2.1, 1),
    trunk: new THREE.MeshLambertMaterial({ color: 0x5a3d26 }),
    crown: new THREE.MeshLambertMaterial({ color: 0x3a7a2a, flatShading: true }),
  };
  return SHARED;
}

/** O lago reflete o mesmo céu da lataria dos carros. */
export function setWaterEnvMap(tex) { const M = shared(); M.water.envMap = tex; M.water.needsUpdate = true; }

// ---------------------------------------------------------------------------------------------
// RUNTIME, em Web Worker (sem travar a tela): calcula a geometria de um bloco do mapa só com números.
// `built` guarda os IDs já construídos (um prédio na divisa não aparece duas vezes).
// ---------------------------------------------------------------------------------------------
// exclude: retângulos girados { cx, cz, c, s, hw, hd } onde o jogo põe um prédio modelado à mão (Dom Olívio):
// os prédios, árvores, áreas e ruas de serviço genéricos do OSM não são construídos ali.
export function computeWorld(data, proj, built = new Set(), exclude = []) {
  const excluded = (x, z) => exclude.some((R) => { const dx = x - R.cx, dz = z - R.cz; return Math.abs(dx * R.c - dz * R.s) < R.hw && Math.abs(dx * R.s + dz * R.c) < R.hd; });
  const ids = [];
  const wall = { p: [], n: [], c: [], u: [], b: [] }, roof = { p: [], n: [], c: [] }, tile = { p: [], n: [], c: [], u: [] };
  const road = { p: [], u: [], f: [] }, walk = { p: [] }, curb = { p: [], n: [] };
  const park = { p: [] }, water = { p: [] }, lot = { p: [] }, rail = { p: [], u: [], f: [] };
  const trees = [], polys = [], grid = new Map(), G = 60;
  const segs = new Map(), SG = 25; // trechos de rua/trilho (para não construir casa em cima)
  const parks = [], lakes = [], bairros = [];
  const col = new THREE.Color();
  let auto = 1, nb = 0, nInfill = 0;

  // Trechos de rua longos são cortados em pedaços de até SUB m: com o relevo, cada vértice sobe pela
  // altura do terreno, e um pedaço comprido cortaria um morro (ou flutuaria sobre um vale).
  const SUB = 12;
  const pieces = (a, b, L) => { const n = Math.max(1, Math.ceil(L / SUB)), out = []; for (let k = 0; k < n; k++) out.push([[a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n], L * k / n, L / n]); return out; };
  const ribbon = (buf, a0, b0, ox, oz, y, v00, L0, mark) => { for (const [a, b, dv, L] of pieces(a0, b0, L0)) ribbonPiece(buf, a, b, ox, oz, y, v00 + dv, L, mark); };
  const ribbonPiece = (buf, a, b, ox, oz, y, v0, L, mark) => {
    const P = [[a[0] + ox, a[1] + oz, 0, v0], [b[0] + ox, b[1] + oz, 0, v0 + L], [a[0] - ox, a[1] - oz, 1, v0],
      [b[0] + ox, b[1] + oz, 0, v0 + L], [b[0] - ox, b[1] - oz, 1, v0 + L], [a[0] - ox, a[1] - oz, 1, v0]];
    for (const q of P) { buf.p.push(q[0], y, q[1]); if (buf.u) { buf.u.push(q[2], q[3]); buf.f.push(mark); } }
  };

  function addSeg(a, b, hw) {
    const k0x = Math.floor(Math.min(a[0], b[0]) / SG), k1x = Math.floor(Math.max(a[0], b[0]) / SG);
    const k0z = Math.floor(Math.min(a[1], b[1]) / SG), k1z = Math.floor(Math.max(a[1], b[1]) / SG);
    for (let i = k0x; i <= k1x; i++) for (let j = k0z; j <= k1z; j++) { const k = i + ',' + j; (segs.get(k) || segs.set(k, []).get(k)).push([a[0], a[1], b[0], b[1], hw]); }
  }
  function nearRoad(x, z, pad) {
    const ci = Math.floor(x / SG), cj = Math.floor(z / SG);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const l = segs.get(i + ',' + j);
      if (l) for (const s of l) if (segDist(x, z, s[0], s[1], s[2], s[3]) < s[4] + pad) return true;
    }
    return false;
  }
  function insideBuilding(x, z) {
    const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G));
    if (l) for (const i of l) if (inPoly(x, z, polys[i])) return true;
    return false;
  }
  const inArea = (x, z) => parks.some((P) => inPoly(x, z, P.pts)) || lakes.some((P) => inPoly(x, z, P));

  // Meio-fio: faixa elevada de 14 cm na borda da pista (topo + face voltada para a rua).
  function curbStrip(a0, b0, nx, nz, w, y) {
    for (const [a, b] of pieces(a0, b0, Math.hypot(b0[0] - a0[0], b0[1] - a0[1]))) curbPiece(a, b, nx, nz, w, y);
  }
  function curbPiece(a, b, nx, nz, w, y) {
    const H = 0.14, W = 0.18;
    const i0 = [a[0] + nx * w, a[1] + nz * w], i1 = [b[0] + nx * w, b[1] + nz * w];
    const o0 = [a[0] + nx * (w + W), a[1] + nz * (w + W)], o1 = [b[0] + nx * (w + W), b[1] + nz * (w + W)];
    for (const q of [i0, i1, o0, i1, o1, o0]) { curb.p.push(q[0], H, q[1]); curb.n.push(0, 1, 0); }
    for (const q of [[i0, y], [i1, y], [i0, H], [i1, y], [i1, H], [i0, H]]) { curb.p.push(q[0][0], q[1], q[0][1]); curb.n.push(-nx, 0, -nz); }
  }

  // Parede vertical de (ax,az) a (bx,bz), do chão y0 até y1. zone/hTop vão para o shader da fachada.
  function wallQuad(ax, az, bx, bz, y0, y1, zone, hTop, u0 = 0) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.01) return 0;
    const nx = dz / L, nz = -dx / L;
    for (const q of [[ax, y0, az, u0, y0], [bx, y0, bz, u0 + L, y0], [ax, y1, az, u0, y1], [bx, y0, bz, u0 + L, y0], [bx, y1, bz, u0 + L, y1], [ax, y1, az, u0, y1]]) {
      wall.p.push(q[0], q[1], q[2]); wall.n.push(nx, 0, nz); wall.c.push(col.r, col.g, col.b); wall.u.push(q[3], q[4]); wall.b.push(zone, hTop);
    }
    return L;
  }

  // Triângulo de telhado com normal para cima (ordem dos vértices corrigida para o DoubleSide iluminar certo).
  function roofTri(buf, a, b, c, rc, uvs) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let order = [0, 1, 2];
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; order = [0, 2, 1]; }
    const L = Math.hypot(nx, ny, nz) || 1, P = [a, b, c];
    for (const k of order) {
      buf.p.push(P[k][0], P[k][1], P[k][2]); buf.n.push(nx / L, ny / L, nz / L); buf.c.push(rc.r, rc.g, rc.b);
      if (buf.u) buf.u.push(uvs[k][0], uvs[k][1]);
    }
  }

  // Telhado de quatro águas (telha cerâmica): retângulo → cumeeira no eixo maior; outros convexos → pirâmide.
  function hipRoof(pts, h, rc) {
    let ridge;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let span;
    if (pts.length === 4) {
      const e0 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), e1 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
      const [La, Lb, i] = e0 >= e1 ? [e0, e1, 0] : [e1, e0, 1];
      const dx = (pts[i + 1][0] - pts[i][0]) / La, dz = (pts[i + 1][1] - pts[i][1]) / La, r = Math.max(0, (La - Lb) / 2);
      span = Lb;
      ridge = [[cx - dx * r, cz - dz * r], [cx + dx * r, cz + dz * r]];
    } else {
      span = Math.sqrt(Math.abs(area(pts)));
      ridge = [[cx, cz]];
    }
    const rise = Math.min(2.6, 0.3 * span), top = h + rise;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.01) continue;
      const near = (p) => ridge.reduce((best, r) => (Math.hypot(r[0] - p[0], r[1] - p[1]) < Math.hypot(best[0] - p[0], best[1] - p[1]) ? r : best));
      const ra = near(a), rb = near(b);
      const uvOf = (p, y) => { // u ao longo do beiral, v subindo pela água do telhado
        const t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L, d = Math.abs(((p[0] - a[0]) * ez - (p[1] - a[1]) * ex) / L);
        return [t, Math.hypot(d, y - h)];
      };
      const A = [a[0], h, a[1]], B = [b[0], h, b[1]], RA = [ra[0], top, ra[1]], RB = [rb[0], top, rb[1]];
      roofTri(tile, A, B, RB, rc, [uvOf(a, h), uvOf(b, h), uvOf(rb, top)]);
      if (ra !== rb) roofTri(tile, A, RB, RA, rc, [uvOf(a, h), uvOf(rb, top), uvOf(ra, top)]);
    }
  }

  // Caixa (torre) alinhada a (dx,dz), centro (cx,cz), meia-largura sx/sz, do chão até h; topo com pináculo.
  function tower(cx, cz, dx, dz, s, h, spire, zone, rc) {
    const px = -dz, pz = dx;
    const C = [[cx + (dx + px) * s, cz + (dz + pz) * s], [cx + (dx - px) * s, cz + (dz - pz) * s], [cx + (-dx - px) * s, cz + (-dz - pz) * s], [cx + (-dx + px) * s, cz + (-dz + pz) * s]];
    if (area(C) < 0) C.reverse();
    let u = 0;
    for (let i = 0; i < 4; i++) u += wallQuad(C[i][0], C[i][1], C[(i + 1) % 4][0], C[(i + 1) % 4][1], BURY, h, zone, h, u);
    const apex = [cx, h + spire, cz];
    for (let i = 0; i < 4; i++) roofTri(roof, [C[i][0], h, C[i][1]], [C[(i + 1) % 4][0], h, C[(i + 1) % 4][1]], apex, rc);
  }

  function addPoly(pts) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const idx = polys.push(pts) - 1;
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(idx);
    }
  }

  function building(pts, t, s) {
    pts = pts.slice(0, -1);
    if (pts.length < 3) return;
    if (exclude.length && excluded(pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length)) return;
    let A = area(pts);
    if (A < 0) { pts.reverse(); A = -A; }
    let lv = parseFloat(t['building:levels']) || 0, h = parseFloat(t.height) || 0;
    if (!lv) lv = A < 300 ? 1 + Math.floor(rnd(s) * 2) : 2 + Math.floor(rnd(s) * 4);
    if (!h) h = lv * 3.2 + 0.6;
    const b = t.building, name = t.name || '';
    let zone = t._zone === 'industrial' ? Z.INDUSTRIA : t._zone === 'commercial' || t._zone === 'retail' ? Z.COMERCIO : t.shop || t.amenity || ['retail', 'commercial', 'supermarket', 'kiosk', 'office'].includes(b) ? Z.COMERCIO
      : ['industrial', 'warehouse', 'factory', 'shed', 'manufacture', 'hangar'].includes(b) ? Z.INDUSTRIA
      : ['house', 'residential', 'detached', 'apartments', 'terrace', 'semidetached_house'].includes(b) ? Z.CASA
      : lv >= 2 && rnd(s + 5) < 0.35 ? Z.COMERCIO : Z.CASA;
    if (zone === Z.INDUSTRIA && !t.height && !t['building:levels']) { h = 6.5 + rnd(s + 9) * 3.5; lv = 2; } // galpão industrial: baixo e largo
    if (zone === Z.INDUSTRIA && rnd(s + 13) < 0.35) zone = Z.TIJOLO; // galpões antigos de tijolo aparente
    if ((b === 'office' || zone === Z.COMERCIO) && lv >= 8 && rnd(s + 17) < 0.4) zone = Z.VIDRO;
    // pontos marcantes de Jundiaí reconhecidos pelo nome no OpenStreetMap
    const church = /catedral|desterro|igreja|matriz|santu[áa]rio/i.test(name) || b === 'church' || b === 'cathedral';
    if (/fepasa|ferrovi[áa]ri|esta[çc][ãa]o|oficinas|armaz[ée]m/i.test(name) || b === 'train_station') zone = Z.TIJOLO;
    if (/pa[çc]o municipal|prefeitura/i.test(name)) { zone = Z.VIDRO; h = Math.max(h, 26); }
    if (/shopping/i.test(name)) { zone = Z.COMERCIO; h = Math.max(h, 14); }
    if (church) { zone = Z.IGREJA; h = Math.max(h, /catedral|desterro/i.test(name) ? 18 : 11); }
    col.setHex(zone === Z.IGREJA ? 0xf3ead2 : zone === Z.CASA && A < 300 ? HOUSE[Math.floor(rnd(s + 1) * HOUSE.length)] : PALETTE[Math.floor(rnd(s + 1) * PALETTE.length)]);
    let u = 0;
    for (let i = 0; i < pts.length; i++) u += wallQuad(pts[i][0], pts[i][1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1], BURY, h, zone, h, u);
    const pitched = zone === Z.CASA && lv <= 2 && A > 25 && A < 320 && pts.length <= 6 && !t.height && convex(pts);
    const rc = new THREE.Color(pitched ? 0xffffff : zone === Z.INDUSTRIA || zone === Z.TIJOLO ? 0xa3aab0 : lv <= 2 ? 0x9c4a32 : 0x8a8a86) // telha · zinco · barro · laje
      .multiplyScalar(0.8 + rnd(s + 2) * 0.25);
    if (pitched) hipRoof(pts, h, rc);
    else for (const f of THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])) {
      for (const i of f) { roof.p.push(pts[i][0], h, pts[i][1]); roof.n.push(0, 1, 0); roof.c.push(rc.r, rc.g, rc.b); }
    }
    if (church) { // duas torres com pináculo na fachada (lado mais curto do prédio)
      let bi = 0, bl = Infinity;
      for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length], L = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]); if (L > 6 && L < bl) { bl = L; bi = i; } }
      const a = pts[bi], q = pts[(bi + 1) % pts.length], ex = (q[0] - a[0]) / bl, ez = (q[1] - a[1]) / bl;
      const ix = -ez, iz = ex, big = /catedral|desterro/i.test(name), s2 = big ? 2.4 : 1.6; // (ix,iz) aponta para dentro
      for (const f of [0.18, 0.82]) {
        const tx = a[0] + (q[0] - a[0]) * f + ix * s2, tz = a[1] + (q[1] - a[1]) * f + iz * s2;
        tower(tx, tz, ex, ez, s2, h + (big ? 16 : 8), big ? 9 : 5, Z.IGREJA, new THREE.Color(0x4e5a57));
      }
    }
    addPoly(pts);
    nb++;
  }

  // Triângulo dividido em 4 até os lados terem no máximo 14 m (o relevo deforma cada vértice).
  function tess(buf, a, b, c, y, depth) {
    const L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
    if (L <= 14 || depth >= 6) { buf.p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); return; }
    const m = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], ab = m(a, b), bc = m(b, c), ca = m(c, a);
    tess(buf, a, ab, ca, y, depth + 1); tess(buf, ab, b, bc, y, depth + 1); tess(buf, ca, bc, c, y, depth + 1); tess(buf, ab, bc, ca, y, depth + 1);
  }

  // Áreas planas: parque (grama), lago, estacionamento.
  function flatArea(buf, pts, y) {
    pts = pts.slice(0, -1);
    if (pts.length < 3) return;
    if (area(pts) < 0) pts.reverse();
    try {
      for (const f of THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])) tess(buf, pts[f[0]], pts[f[1]], pts[f[2]], y, 0);
    } catch { /* polígono inválido: ignora */ }
    return pts;
  }

  function roadWay(pts, t, s) {
    const hw = t.highway, w = ROADW[hw] / 2, foot = !DRIVABLE.has(hw);
    const y = foot ? 0.035 : 0.06 + w * 0.002, mark = foot || w < 3.5 ? 0 : AVENIDA.has(hw) && w >= 5 ? 2 : 1;
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = -dz / L, nz = dx / L;
      addSeg(a, b, foot ? w + 0.3 : w + 2.6);
      ribbon(foot ? walk : road, a, b, nx * w, nz * w, y, dist, L, mark);
      if (!foot && hw !== 'service') {
        ribbon(walk, a, b, nx * (w + 2.6), nz * (w + 2.6), 0.025, dist, L, 0);
        for (const sd of [1, -1]) curbStrip(a, b, nx * sd, nz * sd, w, y);
      }
      if (hw === 'residential' || hw === 'tertiary' || hw === 'secondary' || AVENIDA.has(hw)) {
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
      if (BAIRRO.has(hw)) bairros.push([pts, w, s]);
    }
  }

  function railWay(pts) {
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      addSeg(a, b, 3);
      ribbon(rail, a, b, (-dz / L) * 1.5, (dx / L) * 1.5, 0.05, dist, L, 0);
      dist += L;
    }
  }

  // Bairro de casas: onde o OpenStreetMap não tem prédio desenhado, preenche os lotes ao longo das ruas
  // residenciais com casas (1–2 andares, telhado de telha), muro com portão na frente e árvore no quintal.
  function infill(pts, w, s) {
    for (let i = 0; i < pts.length - 1 && nInfill < 420; i++) {
      const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 16) continue;
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
      for (let d = 8; d < L - 8; d += 11 + rnd(s + i * 31 + d) * 3) {
        for (const side of [1, -1]) {
          const k = s + i * 97 + d * 13 + side * 7;
          if (rnd(k) < 0.12) continue; // terreno baldio
          const wid = 7 + rnd(k + 1) * 2.5, dep = 9 + rnd(k + 2) * 4, front = w + 2.75, yard = 2.5 + rnd(k + 3) * 2;
          const bx = a[0] + ux * d + nx * side * (front + yard), bz = a[1] + uz * d + nz * side * (front + yard);
          const P = (al, ac) => [bx + ux * al + nx * side * ac, bz + uz * al + nz * side * ac];
          // casa ocupa de 0 a dep para dentro; lote vai do muro (−yard) ao fundo (dep + 4)
          const probes = [];
          for (const al of [-wid / 2 - 0.8, 0, wid / 2 + 0.8]) for (const ac of [-yard + 0.7, dep / 2, dep + 4]) probes.push(P(al, ac));
          if (probes.some(([x, z]) => insideBuilding(x, z) || nearRoad(x, z, 0.4) || inArea(x, z) || (exclude.length && excluded(x, z)))) continue;
          const house = [P(-wid / 2, 0), P(wid / 2, 0), P(wid / 2, dep), P(-wid / 2, dep)];
          house.push(house[0]);
          const lv = rnd(k + 4) < 0.22 ? '2' : '1';
          building(house, { building: 'house', 'building:levels': lv }, k);
          nInfill++;
          // muro na divisa com a calçada, com portão de garagem
          const m0 = P(-wid / 2 - 0.9, -yard), m1 = P(wid / 2 + 0.9, -yard), gL = rnd(k + 5) < 0.5;
          const g0 = P(gL ? -wid / 2 + 0.2 : wid / 2 - 3.2, -yard), g1 = P(gL ? -wid / 2 + 3.2 : wid / 2 - 0.2, -yard);
          col.setHex(HOUSE[Math.floor(rnd(k + 6) * HOUSE.length)]).multiplyScalar(0.92);
          const hm = 1.8 + rnd(k + 7) * 0.5;
          wallQuad(m0[0], m0[1], g0[0], g0[1], -0.6, hm, Z.MURO, hm);
          wallQuad(g1[0], g1[1], m1[0], m1[1], -0.6, hm, Z.MURO, hm);
          wallQuad(g0[0], g0[1], g1[0], g1[1], -0.6, hm + 0.1, Z.PORTAO, hm + 0.1);
          if (rnd(k + 8) < 0.6) trees.push(P((rnd(k + 9) - 0.5) * wid, dep + 2.6)); // quintal arborizado
        }
      }
    }
  }

  // ---- leitura dos elementos do OSM ----
  for (const el of data.elements) {
    const t = el.tags || {};
    const uid = el.type[0] + el.id;
    if (built.has(uid)) continue;
    const s = typeof el.id === 'number' ? el.id % 100000 : auto++;
    const isPark = /^(park|garden|recreation_ground|playground|village_green|nature_reserve)$/.test(t.leisure || '') || /^(grass|forest|recreation_ground|village_green|meadow)$/.test(t.landuse || '') || t.natural === 'wood';
    const isWater = t.natural === 'water' || !!t.water || t.landuse === 'reservoir' || t.landuse === 'basin';
    const isLot = t.amenity === 'parking' && !t.building && t.parking !== 'underground' && t.parking !== 'multi-storey';
    const outerRings = () => (el.type === 'relation' ? (el.members || []).filter((m) => m.role === 'outer' && m.geometry) : el.geometry ? [{ geometry: el.geometry }] : [])
      .map((m) => m.geometry.filter(Boolean).map((g) => proj.toXZ(g.lon, g.lat))).filter((p) => p.length >= 4);
    if (!t.building && (isPark || isWater || isLot)) {
      built.add(uid); ids.push(uid);
      for (const ring of outerRings()) {
        if (exclude.length && excluded(ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length)) continue;
        if (isWater) { const P = flatArea(water, ring, 0.02); if (P) lakes.push(P); }
        else if (isLot) flatArea(lot, ring, 0.03);
        else { const P = flatArea(park, ring, 0.012); if (P) parks.push({ pts: P, dense: t.landuse === 'forest' || t.natural === 'wood' ? 0.85 : 0.42 }); }
      }
      continue;
    }
    if (el.type === 'relation' && t.building && el.members) {
      // prédios grandes desenhados como "relação" (multipolígono): usa os contornos externos
      built.add(uid); ids.push(uid);
      for (const pts of outerRings()) building(pts, t, s + pts.length);
      continue;
    }
    if (el.type !== 'way' || !el.geometry) continue;
    const pts = el.geometry.filter(Boolean).map((g) => proj.toXZ(g.lon, g.lat));
    if (pts.length < 2) continue;
    if (t.building && pts.length >= 4) { built.add(uid); ids.push(uid); building(pts, t, s); }
    else if (t.highway && ROADW[t.highway]) {
      built.add(uid); ids.push(uid);
      // caminhos de pedestre e ruas de serviço que passam pelo terreno do Dom (qualquer ponto do trajeto) saem
      if (exclude.length && (!DRIVABLE.has(t.highway) || t.highway === 'service')) {
        let hit = false;
        for (let i = 0; i < pts.length - 1 && !hit; i++) for (let k = 0; k <= 8 && !hit; k++) hit = excluded(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 8, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 8);
        if (hit) continue;
      }
      roadWay(pts, t, s);
    }
    else if (/^(rail|light_rail|narrow_gauge|disused|preserved)$/.test(t.railway || '') && t.tunnel !== 'yes') { built.add(uid); ids.push(uid); railWay(pts); }
  }

  // casas nos bairros (depois de todos os prédios reais do bloco, para não sobrepor)
  for (const [pts, w, s] of bairros) infill(pts, w, s);

  // árvores dos parques e bosques (fora dos lagos e dos prédios)
  for (const { pts, dense } of parks) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, n = 0;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    for (let x = x0 + 6; x < x1 && n < 500; x += 11) for (let z = z0 + 6; z < z1 && n < 500; z += 11) {
      const jx = x + (rnd(x * 1.3 + z) - 0.5) * 8, jz = z + (rnd(z * 1.7 - x) - 0.5) * 8;
      if (rnd(jx * 0.7 + jz * 1.1) > dense || !inPoly(jx, jz, pts) || lakes.some((L) => inPoly(jx, jz, L)) || nearRoad(jx, jz, -0.5)) continue;
      trees.push([jx, jz]); n++;
    }
  }

  const okTrees = trees.filter(([x, z]) => !insideBuilding(x, z) && !(exclude.length && excluded(x, z)));
  const f32 = (arr) => (arr && arr.length ? new Float32Array(arr) : null);
  const pack = (b) => ({ p: f32(b.p), n: f32(b.n), c: f32(b.c), u: f32(b.u), f: f32(b.f), b: f32(b.b) });
  return {
    wall: pack(wall), roof: pack(roof), tile: pack(tile), road: pack(road), walk: pack(walk), curb: pack(curb),
    park: pack(park), water: pack(water), lot: pack(lot), rail: pack(rail),
    trees: new Float32Array(okTrees.flat()), polys: polys.map((P) => new Float32Array(P.flat())), ids,
    stats: { buildings: nb, houses: nInfill, trees: okTrees.length, parks: parks.length, lakes: lakes.length },
  };
}
export const MESH_KEYS = ['wall', 'roof', 'tile', 'road', 'walk', 'curb', 'park', 'water', 'lot', 'rail'];

/** Teste "este ponto está dentro de um prédio?" a partir dos contornos (Float32Array x,z,x,z...). */
export function insideFromPolys(flatPolys) {
  const G = 60, grid = new Map();
  const polys = flatPolys.map((F) => { const P = []; for (let i = 0; i < F.length; i += 2) P.push([F[i], F[i + 1]]); return P; });
  polys.forEach((P, idx) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of P) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / G); i <= Math.floor(x1 / G); i++) for (let j = Math.floor(z0 / G); j <= Math.floor(z1 / G); j++) {
      const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(idx);
    }
  });
  return (x, z) => {
    const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G));
    if (l) for (const i of l) if (inPoly(x, z, polys[i])) return true;
    return false;
  };
}

// RUNTIME, thread principal (rápido): transforma os números calculados em malhas e no teste "dentro de prédio".
export function assembleWorld(r) {
  const M = shared();
  const insideBuilding = insideFromPolys(r.polys);
  const group = new THREE.Group();
  const mesh = (b, mat, { cast = false, uv = null, lodFar = null } = {}) => {
    if (!b?.p || !b.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.p, 3));
    if (b.n) g.setAttribute('normal', new THREE.BufferAttribute(b.n, 3));
    else { const n = new Float32Array(b.p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
    if (b.c) g.setAttribute('color', new THREE.BufferAttribute(b.c, 3));
    if (b.u) g.setAttribute(uv || 'wuv', new THREE.BufferAttribute(b.u, 2));
    if (b.f) g.setAttribute('flag', new THREE.BufferAttribute(b.f, 1));
    if (b.b) g.setAttribute('binfo', new THREE.BufferAttribute(b.b, 2));
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.userData.caster = cast; // o LOD decide quais blocos projetam sombra
    m.receiveShadow = true;
    if (lodFar) m.userData.lod = { near: mat, far: lodFar };
    group.add(m);
    return m;
  };
  mesh(r.park, M.park);
  mesh(r.water, M.water);
  const lot = mesh(r.lot, M.lot);
  if (lot) lot.userData.detail = true;
  mesh(r.walk, M.walk);
  mesh(r.curb, M.curb);
  mesh(r.road, M.road);
  const rail = mesh(r.rail, M.rail, { uv: 'uv' });
  if (rail) rail.userData.detail = true;
  mesh(r.wall, M.wall, { cast: true, uv: 'uv', lodFar: M.wallFar }); // LOD: longe, parede sem o cálculo de janelas
  mesh(r.roof, M.roof, { cast: true });
  mesh(r.tile, M.tile, { cast: true, uv: 'uv' });
  const nTrees = r.trees.length / 2;
  if (nTrees) { // árvores: 2 InstancedMesh (tronco + copa) por bloco
    const trunk = new THREE.InstancedMesh(M.trunkGeo, M.trunk, nTrees);
    const crown = new THREE.InstancedMesh(M.crownGeo, M.crown, nTrees);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), cc = new THREE.Color();
    for (let i = 0; i < nTrees; i++) {
      const x = r.trees[i * 2], z = r.trees[i * 2 + 1], s = 0.75 + rnd(x * 3.1 + z) * 0.6;
      trunk.setMatrixAt(i, m4.compose(v.set(x, 1.5 * s, z), q, sc.set(s, s, s)));
      crown.setMatrixAt(i, m4.compose(v.set(x, 4.0 * s, z), q, sc.set(s, s * 0.85, s)));
      crown.setColorAt(i, cc.setHSL(0.26 + rnd(x + z * 7) * 0.08, 0.45, 0.85 + rnd(z - x) * 0.3)); // tons de verde variados
    }
    trunk.castShadow = crown.castShadow = true;
    trunk.userData.caster = crown.userData.caster = true;
    trunk.userData.detail = crown.userData.detail = true;
    group.add(trunk, crown);
  }
  return { group, ids: r.ids, insideBuilding, wallVerts: r.wall.p || new Float32Array(0), wallIdx: Uint32Array.from({ length: (r.wall.p?.length || 0) / 3 }, (_, i) => i), stats: r.stats };
}

// Pré-compila os shaders na tela de título (evita engasgos na 1ª aparição de cada material no jogo).
export function warmupMaterials(renderer, scene, camera) {
  const M = shared(), g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const probes = [M.wall, M.wallFar, M.roof, M.tile, M.road, M.walk, M.curb, M.park, M.water, M.lot, M.rail].map((m) => new THREE.Mesh(g, m));
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
