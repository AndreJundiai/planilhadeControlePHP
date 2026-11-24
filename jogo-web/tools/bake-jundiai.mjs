// EDITOR TIME (não roda no jogo): baixa o centro urbano de Jundiaí do OpenStreetMap UMA vez e grava
// blocos prontos em public/map/jundiai/<bbox>.json, no mesmo formato que o jogo lê. O jogo e o APK
// carregam esses arquivos locais: zero download durante o gameplay.
// Uso: node tools/bake-jundiai.mjs   (precisa de internet; leva ~5–15 min)
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.env.BAKE_OUT || 'public/map/jundiai');
const CH = 0.004; // tamanho do bloco do jogo (graus) — igual a CONFIG.chunk
const AREA = { south: -23.25, north: -23.12, west: -46.98, east: -46.83 }; // mancha urbana de Jundiaí
const TILE = 0.02; // cada download cobre 5x5 blocos
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const KEEP_TAGS = ['highway', 'name', 'building', 'building:levels', 'height', 'shop', 'amenity', 'leisure', 'landuse', 'natural', 'water', 'railway', 'tunnel', 'parking', 'tourism', 'historic', 'brand'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;

async function overpass(s, w, n, e) {
  const b = `(${s},${w},${n},${e})`;
  const q = `[out:json][timeout:180];(way[highway]${b};way[building]${b};relation[building]${b};node[shop][name]${b};node[amenity][name]${b};way[landuse~"industrial|residential|commercial|retail|grass|forest|recreation_ground|reservoir"]${b};way[leisure~"^(park|garden|recreation_ground|playground)$"]${b};way[natural=water]${b};relation[natural=water]${b};relation[leisure=park]${b};way[amenity=parking]${b};way[railway=rail]${b};node[tourism][name]${b};node[historic][name]${b};);out geom;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = SERVERS[attempt % SERVERS.length];
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AutoTheftJundiai-bake/1.0' } });
      if (r.ok) return (await r.json()).elements;
      console.warn(`  ${url} → HTTP ${r.status}, tentando de novo`);
    } catch (err) { console.warn(`  ${url} → ${err.message}`); }
    await sleep(5000 * (attempt + 1));
  }
  throw new Error('Overpass indisponível');
}

function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
}

const trim = (tags = {}) => Object.fromEntries(Object.entries(tags).filter(([k]) => KEEP_TAGS.includes(k)));
const pts = (el) => (el.geometry || el.members?.flatMap((m) => m.geometry || []) || (el.lat != null ? [{ lat: el.lat, lon: el.lon }] : [])).filter(Boolean);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const all = new Map(); // id → elemento (sem duplicar entre downloads)
  const zones = []; // polígonos de landuse para classificar prédios
  const tiles = [];
  for (let s = AREA.south; s < AREA.north; s += TILE) for (let w = AREA.west; w < AREA.east; w += TILE) tiles.push([s, w]);
  let i = 0;
  for (const [s, w] of tiles) {
    i++;
    const els = await overpass(s.toFixed(5), w.toFixed(5), (s + TILE).toFixed(5), (w + TILE).toFixed(5));
    for (const el of els) {
      // landuse de zona (indústria/comércio/residencial) só classifica prédios; grama/bosque/represa vão para o mapa
      if (/^(industrial|residential|commercial|retail)$/.test(el.tags?.landuse || '') && el.geometry) { zones.push({ z: el.tags.landuse, p: el.geometry.filter(Boolean).map((g) => [g.lon, g.lat]) }); continue; }
      all.set(el.type[0] + el.id, el);
    }
    console.log(`download ${i}/${tiles.length}: ${els.length} elementos (total ${all.size})`);
    await sleep(+(process.env.BAKE_PAUSE ?? 1500)); // pausa entre downloads (respeita o servidor)
  }
  // zona de cada prédio pelo landuse que contém o centro dele (indústria = galpão, etc.)
  let zoned = 0;
  for (const el of all.values()) {
    if (!el.tags?.building) continue;
    const P = pts(el); if (!P.length) continue;
    const cx = P.reduce((a, p) => a + p.lon, 0) / P.length, cy = P.reduce((a, p) => a + p.lat, 0) / P.length;
    const z = zones.find((Z) => inPoly(cx, cy, Z.p));
    if (z) { el._zone = z.z; zoned++; }
  }
  // distribui pelos blocos do jogo (um elemento entra em todo bloco onde tem algum ponto, como o Overpass faz)
  const chunks = new Map();
  for (const el of all.values()) {
    const keys = new Set();
    for (const p of pts(el)) keys.add(Math.floor(p.lon / CH) + ',' + Math.floor(p.lat / CH));
    const out = { type: el.type, id: el.id };
    const t = trim(el.tags); if (el._zone) t._zone = el._zone;
    if (Object.keys(t).length) out.tags = t;
    if (el.nodes) out.nodes = el.nodes;
    if (el.geometry) out.geometry = el.geometry.map((g) => (g ? { lat: r6(g.lat), lon: r6(g.lon) } : null));
    if (el.members) out.members = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => ({ role: 'outer', geometry: m.geometry.filter(Boolean).map((g) => ({ lat: r6(g.lat), lon: r6(g.lon) })) }));
    if (el.lat != null) { out.lat = r6(el.lat); out.lon = r6(el.lon); }
    for (const k of keys) (chunks.get(k) || chunks.set(k, []).get(k)).push(out);
  }
  let bytes = 0;
  for (const [k, els] of chunks) {
    const [cx, cy] = k.split(',').map(Number);
    const bbox = [cy * CH, cx * CH, (cy + 1) * CH, (cx + 1) * CH].map((v) => v.toFixed(5)).join(',');
    const txt = JSON.stringify({ elements: els });
    bytes += txt.length;
    fs.writeFileSync(path.join(OUT, `${bbox}.json`), txt);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ area: AREA, chunk: CH, chunks: chunks.size, buildings: [...all.values()].filter((e) => e.tags?.building).length, zoned, bakedAt: new Date().toISOString() }));
  console.log(`pronto: ${chunks.size} blocos, ${(bytes / 1e6).toFixed(1)} MB, ${zoned} prédios com zona`);
}
main().catch((e) => { console.error(e); process.exit(1); });
