import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

/**
 * Plano B do mapa: quando o Overpass (OpenStreetMap) não responde, lê os tiles vetoriais da
 * OpenFreeMap (outro servidor, mesmos dados do OSM no esquema OpenMapTiles) e converte para o
 * mesmo formato que o resto do jogo usa. Nós das ruas recebem IDs pela coordenada, então
 * cruzamentos e blocos vizinhos se ligam sozinhos.
 */
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 14;
const CLASS_TO_HIGHWAY = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  minor: 'residential', service: 'service', track: 'service', path: 'footway', raceway: 'service', busway: 'service',
};
let templatePromise = null;

function tileTemplate() {
  templatePromise ??= fetch(TILEJSON, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).then((j) => j.tiles[0]).catch((e) => { templatePromise = null; throw e; });
  return templatePromise;
}

const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };
const nodeId = ([lon, lat]) => `n${Math.round(lat * 1e6)}_${Math.round(lon * 1e6)}`;
const hashId = (coords) => { let h = 0; for (const [lo, la] of coords.slice(0, 6)) h = (h * 31 + Math.round(lo * 1e6) * 7 + Math.round(la * 1e6)) | 0; return 'v' + (h >>> 0).toString(36) + coords.length; };
const toGeo = (coords) => coords.map(([lon, lat]) => ({ lon, lat }));

function intersects(coords, [s, w, n, e]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [lo, la] of coords) { x0 = Math.min(x0, lo); x1 = Math.max(x1, lo); y0 = Math.min(y0, la); y1 = Math.max(y1, la); }
  return x1 >= w && x0 <= e && y1 >= s && y0 <= n;
}

// Limites geográficos de um tile (sem a "margem" que os tiles vetoriais trazem).
function tileBox(x, y) {
  const n = 2 ** Z, lon = (i) => (i / n) * 360 - 180, lat = (j) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return { w: lon(x), e: lon(x + 1), n: lat(y), s: lat(y + 1) };
}

// Recorta um polígono no retângulo do tile (Sutherland–Hodgman). Sem isso, prédios na borda
// aparecem duplicados/cortados, porque cada tile traz um pedaço com margem.
function clipPolygon(ring, b) {
  let pts = ring.slice(0, -1);
  const edges = [[(p) => p[0] >= b.w, (a, c) => cutX(a, c, b.w)], [(p) => p[0] <= b.e, (a, c) => cutX(a, c, b.e)],
    [(p) => p[1] >= b.s, (a, c) => cutY(a, c, b.s)], [(p) => p[1] <= b.n, (a, c) => cutY(a, c, b.n)]];
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const A = pts[i], B = pts[(i + 1) % pts.length], ia = inside(A), ib = inside(B);
      if (ia) out.push(A);
      if (ia !== ib) out.push(cut(A, B));
    }
    pts = out;
    if (pts.length < 3) return null;
  }
  return [...pts, pts[0]];
}
const cutX = (a, c, x) => [x, a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])];
const cutY = (a, c, y) => [a[0] + ((c[0] - a[0]) * (y - a[1])) / (c[1] - a[1]), y];

// Recorta uma linha no retângulo do tile (cada trecho que sai e volta vira uma linha separada).
function clipLine(line, b) {
  const inside = (p) => p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n;
  const parts = [];
  let cur = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (inside(p)) {
      if (!cur.length && i > 0) cur.push(edgePoint(line[i - 1], p, b));
      cur.push(p);
    } else if (cur.length) {
      cur.push(edgePoint(p, cur[cur.length - 1], b));
      parts.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) parts.push(cur);
  return parts.filter((l) => l.length > 1);
}
// ponto onde o segmento (fora → dentro) cruza a borda do retângulo
function edgePoint(out, inn, b) {
  let t = 1;
  const dx = out[0] - inn[0], dy = out[1] - inn[1];
  if (out[0] < b.w) t = Math.min(t, (b.w - inn[0]) / dx);
  if (out[0] > b.e) t = Math.min(t, (b.e - inn[0]) / dx);
  if (out[1] < b.s) t = Math.min(t, (b.s - inn[1]) / dy);
  if (out[1] > b.n) t = Math.min(t, (b.n - inn[1]) / dy);
  return [inn[0] + dx * t, inn[1] + dy * t];
}

// Converte um tile decodificado em elementos no formato do Overpass.
export function tileToElements(buf, x, y, bounds) {
  const vt = new VectorTile(new Pbf(buf)), els = [], tb = tileBox(x, y);
  const each = (layer, fn) => { const L = vt.layers[layer]; if (L) for (let i = 0; i < L.length; i++) fn(L.feature(i).toGeoJSON(x, y, Z)); };
  each('building', (f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0].length >= 4 ? clipPolygon(poly[0], tb) : null;
      if (!ring || ring.length < 4 || !intersects(ring, bounds)) continue;
      const tags = { building: 'yes' };
      if (f.properties.render_height) tags.height = String(f.properties.render_height);
      els.push({ type: 'way', id: hashId(ring), tags, geometry: toGeo(ring) });
    }
  });
  const road = (f, named) => {
    const hw = CLASS_TO_HIGHWAY[f.properties.class];
    if (!hw) return;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines.flatMap((l) => clipLine(l, tb))) {
      if (line.length < 2 || !intersects(line, bounds)) continue;
      const tags = { highway: f.properties.subclass === 'pedestrian' ? 'pedestrian' : hw };
      if (named && f.properties.name) tags.name = f.properties.name;
      els.push({ type: 'way', id: hashId(line) + (named ? 'n' : ''), tags, nodes: line.map(nodeId), geometry: toGeo(line) });
    }
  };
  // áreas: parques/gramados/bosques (landcover), lagos e represas (water)
  const area = (f, tags) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0].length >= 4 ? clipPolygon(poly[0], tb) : null;
      if (!ring || ring.length < 4 || !intersects(ring, bounds)) continue;
      els.push({ type: 'way', id: hashId(ring) + 'a', tags: { ...tags }, geometry: toGeo(ring) });
    }
  };
  each('landcover', (f) => {
    if (f.properties.class === 'grass' && /park|garden|grass|recreation|village_green|meadow/.test(f.properties.subclass || '')) area(f, { leisure: 'park' });
    else if (f.properties.class === 'wood') area(f, { landuse: 'forest' });
  });
  each('water', (f) => { if (f.properties.class !== 'ocean') area(f, { natural: 'water' }); });
  // ferrovia
  each('transportation', (f) => {
    if (f.properties.class !== 'rail' || f.properties.brunnel === 'tunnel') return;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines.flatMap((l) => clipLine(l, tb))) if (line.length >= 2 && intersects(line, bounds)) els.push({ type: 'way', id: hashId(line) + 'r', tags: { railway: 'rail' }, geometry: toGeo(line) });
  });
  each('transportation', (f) => road(f, false));
  each('transportation_name', (f) => road(f, true)); // mesmas ruas, com nome (nós iguais = sem duplicar o grafo)
  each('poi', (f) => {
    if (f.geometry.type !== 'Point' || !f.properties.name) return;
    const [lon, lat] = f.geometry.coordinates;
    if (!intersects([[lon, lat]], bounds)) return;
    els.push({ type: 'node', id: nodeId([lon, lat]), lat, lon, tags: { name: f.properties.name, shop: f.properties.subclass || f.properties.class || 'yes' } }); // ex.: supermarket
  });
  return els;
}

// bounds = [sul, oeste, norte, leste]
export async function loadFromVectorTiles(bounds, signal) {
  const [s, w, n, e] = bounds;
  const tpl = await tileTemplate();
  const els = [];
  for (let x = lon2x(w); x <= lon2x(e); x++) {
    for (let y = lat2y(n); y <= lat2y(s); y++) {
      const r = await fetch(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal });
      if (!r.ok) throw new Error('tile ' + r.status);
      els.push(...tileToElements(new Uint8Array(await r.arrayBuffer()), x, y, bounds));
    }
  }
  return { elements: els };
}
