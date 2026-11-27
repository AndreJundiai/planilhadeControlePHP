import * as THREE from 'three';

/**
 * RELEVO REAL DE JUNDIAÍ (ladeiras e morros), sem mexer na física.
 *
 * A lógica do jogo (Rapier, colisões, trânsito, pedestres) continua num plano y = 0. O relevo é
 * uma DEFORMAÇÃO NA HORA DE DESENHAR: todo vértice de todo material do three.js sobe pela altura
 * do terreno no seu x,z (shader). Assim prédios, ruas, carros, pessoas, postes e sombras sobem e
 * descem juntos e sempre se encaixam, e nada precisa ser reescrito para 3D. Só o que não passa
 * pelos shaders padrão (câmera, luzes, partículas, sprites) usa a mesma conta na CPU: `heightAt`.
 *
 * Dados: blocos Terrarium (altitude SRTM ~30 m, PNG) embutidos em public/map/relevo/ pelo
 * tools/bake-jundiai.mjs. Sem eles, tenta a mesma fonte pela internet; sem internet, chão plano.
 */
const Z = 13;
const TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const RELEVO_AREA = { south: -23.27, north: -23.1, west: -47.0, east: -46.81 }; // mancha urbana + pé da Serra

const U = {
  uTerrain: { value: new THREE.DataTexture(new Float32Array(1), 1, 1, THREE.RedFormat, THREE.FloatType) },
  uTerrainBox: { value: new THREE.Vector4(0, 0, 1, 0) }, // x0, z0, 1/célula
  uTerrainSize: { value: new THREE.Vector2(1, 1) },
  uTerrainOn: { value: 0 },
};
U.uTerrain.value.needsUpdate = true;

const GLSL = `
uniform sampler2D uTerrain;
uniform vec4 uTerrainBox;
uniform vec2 uTerrainSize;
uniform float uTerrainOn;
float terrainH(vec2 p) {
  if (uTerrainOn < 0.5) return 0.0;
  vec2 g = clamp((p - uTerrainBox.xy) * uTerrainBox.z, vec2(0.0), uTerrainSize - 1.001);
  ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
  float a = texelFetch(uTerrain, i, 0).r, b = texelFetch(uTerrain, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uTerrain, i + ivec2(0, 1), 0).r, d = texelFetch(uTerrain, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;
/** Para ShaderMaterials próprios: declare TERRAIN_GLSL e some terrainH(world.xz) em world.y. */
export const TERRAIN_GLSL = GLSL;

let patched = false;
/**
 * Liga a deformação em TODOS os shaders padrão (Lambert, Phong, Basic, linhas, pontos, profundidade
 * das sombras...). Chamar uma vez, antes de qualquer material ser compilado.
 */
export function installTerrainShaders() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk;
  C.common = C.common + GLSL;
  C.project_vertex = C.project_vertex.replace('mvPosition = modelViewMatrix * mvPosition;',
    'vec4 tWorld = modelMatrix * mvPosition;\ntWorld.y += terrainH(tWorld.xz);\nmvPosition = viewMatrix * tWorld;');
  C.worldpos_vertex = C.worldpos_vertex.replace('worldPosition = modelMatrix * worldPosition;',
    'worldPosition = modelMatrix * worldPosition;\n\tworldPosition.y += terrainH(worldPosition.xz);');
  // placas (sprites: Dom Olívio, casa, eventos) sobem com o terreno também
  const SL = THREE.ShaderLib.sprite;
  SL.vertexShader = SL.vertexShader.replace('vec4 mvPosition = modelViewMatrix[ 3 ];',
    'vec4 tSpr = modelMatrix[ 3 ];\n\ttSpr.y += terrainH(tSpr.xz);\n\tvec4 mvPosition = viewMatrix * tSpr;');
  // Todo programa recebe os MESMOS objetos de uniform (o three clona os uniforms de cada material, então
  // eles são injetados no onBeforeCompile — inclusive nos materiais de sombra que o próprio three cria).
  const inject = function (sh) {
    Object.assign(sh.uniforms, U);
    if (globalThis.__compileLog) globalThis.__compileLog.push(`${this?.type}${this?.name ? ':' + this.name : ''} ${sh.shaderName}`); // depuração: quem compila durante o jogo
  };
  const proto = THREE.Material.prototype;
  Object.defineProperty(proto, 'onBeforeCompile', {
    configurable: true,
    get() { return this._tObc || inject; },
    set(fn) { this._tKey = fn.toString(); this._tObc = function (sh, r) { inject.call(this, sh); return fn.call(this, sh, r); }; },
  });
  // a chave de cache do programa continua sendo o código do onBeforeCompile ORIGINAL de cada material
  proto.customProgramCacheKey = function () { return this._tKey || ''; };
}

// precisa rodar antes de qualquer módulo criar materiais (main.js importa este arquivo primeiro)
if (typeof document !== 'undefined') installTerrainShaders();

// ---- dados ------------------------------------------------------------------------------------
let grid = null; // { h: Float32Array, nx, nz, x0, z0, inv }

/** Altura do terreno (m) no ponto x,z do mundo — a mesma conta do shader. */
export function heightAt(x, z) {
  if (!grid) return 0;
  const gx = Math.min(Math.max((x - grid.x0) * grid.inv, 0), grid.nx - 1.001), gz = Math.min(Math.max((z - grid.z0) * grid.inv, 0), grid.nz - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, H = grid.h, k = j * grid.nx + i;
  const a = H[k], b = H[k + 1], c = H[k + grid.nx], d = H[k + grid.nx + 1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
export const terrainOn = () => !!grid;

/**
 * Nivela o terreno num retângulo girado (terraplenagem de um prédio grande): dentro fica na altura do
 * centro; numa margem em volta, faz a transição suave para o relevo original.
 */
export function flattenArea({ cx, cz, c, s, hw, hd }, margin = 25) {
  if (!grid) return 0;
  const target = heightAt(cx, cz), H = grid.h, R = Math.hypot(hw, hd) + margin;
  const i0 = Math.max(0, Math.floor((cx - R - grid.x0) * grid.inv)), i1 = Math.min(grid.nx - 1, Math.ceil((cx + R - grid.x0) * grid.inv));
  const j0 = Math.max(0, Math.floor((cz - R - grid.z0) * grid.inv)), j1 = Math.min(grid.nz - 1, Math.ceil((cz + R - grid.z0) * grid.inv));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = grid.x0 + i / grid.inv, z = grid.z0 + j / grid.inv, dx = x - cx, dz = z - cz;
    const ex = Math.max(0, Math.abs(dx * c - dz * s) - hw), ez = Math.max(0, Math.abs(dx * s + dz * c) - hd);
    const t = Math.min(1, Math.hypot(ex, ez) / margin), k = t * t * (3 - 2 * t); // 0 dentro, 1 fora da margem
    H[j * grid.nx + i] = target + (H[j * grid.nx + i] - target) * k;
  }
  U.uTerrain.value.needsUpdate = true;
  return target;
}

const lon2x = (lon) => ((lon + 180) / 360) * 2 ** Z;
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z; };

async function loadTile(x, y, live) {
  const url = live ? `${TILE_URL}/${Z}/${x}/${y}.png` : `./map/relevo/${Z}_${x}_${y}.png`;
  const r = await fetch(url, live ? { signal: AbortSignal.timeout(8000) } : undefined);
  if (!r.ok || !(r.headers.get('content-type') || 'image/png').includes('image')) throw new Error('relevo ' + r.status);
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, 256, 256).data, out = new Float32Array(256 * 256);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return out;
}

/**
 * Carrega o relevo e monta uma grade em coordenadas do MUNDO (célula de `cell` m), relativa à
 * altitude do ponto de partida (o André começa em y = 0). Retorna a fonte usada ou null (plano).
 */
export async function loadTerrain(proj, { cell = 20, synthetic = false, onProgress } = {}) {
  let sample;
  let source = 'sintético';
  if (synthetic) { // cidade de teste: morros suaves de mentira (exercita o caminho do relevo sem internet)
    sample = (lon, lat) => { const [x, z] = proj.toXZ(lon, lat); return 6 * Math.sin(x / 140) + 5 * Math.cos(z / 170) + 3 * Math.sin((x + z) / 90); };
  } else {
    const A = RELEVO_AREA, tx0 = Math.floor(lon2x(A.west)), tx1 = Math.floor(lon2x(A.east)), ty0 = Math.floor(lat2y(A.north)), ty1 = Math.floor(lat2y(A.south));
    const tiles = new Map();
    let n = 0;
    const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    for (const live of [false, true]) {
      try {
        for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
          if (!tiles.has(x + ',' + y)) { tiles.set(x + ',' + y, await loadTile(x, y, live)); onProgress?.(++n / total); }
        }
        source = live ? 'internet' : 'embutido';
        break;
      } catch { if (live) return null; } // embutido faltando → tenta a internet; sem internet → plano
    }
    sample = (lon, lat) => {
      const fx = lon2x(lon), fy = lat2y(lat), x = Math.floor(fx), y = Math.floor(fy);
      const T = tiles.get(x + ',' + y);
      if (!T) return NaN;
      const px = Math.min(254.999, (fx - x) * 256), py = Math.min(254.999, (fy - y) * 256), i = Math.floor(px), j = Math.floor(py), u = px - i, v = py - j, k = j * 256 + i;
      return (T[k] * (1 - u) + T[k + 1] * u) * (1 - v) + (T[k + 256] * (1 - u) + T[k + 257] * u) * v;
    };
  }
  // grade do mundo cobrindo a área
  const A = RELEVO_AREA;
  const c1 = proj.toXZ(A.west, A.north), c2 = proj.toXZ(A.east, A.south);
  const x0 = Math.min(c1[0], c2[0]), x1 = Math.max(c1[0], c2[0]), z0 = Math.min(c1[1], c2[1]), z1 = Math.max(c1[1], c2[1]);
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  const base = sample(proj.lon0, proj.lat0) || 0;
  let h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const [lon, lat] = proj.toLonLat(x0 + i * cell, z0 + j * cell), e = sample(lon, lat);
    h[j * nx + i] = Number.isFinite(e) ? e - base : 0;
  }
  // suaviza o ruído do SRTM (copas de árvore e prédios entram na medição): 2 passadas de média 3x3
  for (let pass = 0; pass < 2; pass++) {
    const o = new Float32Array(h.length);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let s = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nx && b < nz) { s += h[b * nx + a]; w++; } }
      o[j * nx + i] = s / w;
    }
    h = o;
  }
  grid = { h, nx, nz, x0, z0, inv: 1 / cell };
  const tex = new THREE.DataTexture(h, nx, nz, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  U.uTerrain.value = tex;
  U.uTerrainBox.value.set(x0, z0, 1 / cell, 0);
  U.uTerrainSize.value.set(nx, nz);
  U.uTerrainOn.value = 1;
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return { source, cells: nx * nz, min: lo, max: hi, base };
}

/**
 * Chão que acompanha o jogador: grade de 1,6 km (célula de 10 m) recentrada em degraus de 40 m.
 * As posições ficam em y = 0 (o shader sobe cada vértice); as NORMAIS vêm da inclinação real,
 * então as encostas recebem sombreamento de luz.
 */
export class TerrainGround {
  constructor(scene, material, size = 1600, seg = 160) {
    this.geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.step = 40;
    this.cx = this.cz = Infinity;
    scene.add(this.mesh);
  }
  update(x, z) {
    const cx = Math.round(x / this.step) * this.step, cz = Math.round(z / this.step) * this.step;
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx; this.cz = cz;
    this.mesh.position.set(cx, -0.03, cz); // um pouco abaixo das ruas e calçadas
    const p = this.geo.attributes.position, n = this.geo.attributes.normal, e = 3;
    if (!terrainOn()) return;
    for (let i = 0; i < p.count; i++) {
      const wx = p.getX(i) + cx, wz = p.getZ(i) + cz;
      const dx = heightAt(wx + e, wz) - heightAt(wx - e, wz), dz = heightAt(wx, wz + e) - heightAt(wx, wz - e);
      const l = Math.hypot(dx, 2 * e, dz);
      n.setXYZ(i, -dx / l, (2 * e) / l, -dz / l);
    }
    n.needsUpdate = true;
  }
}
