// EDITOR TIME (não roda no jogo): baixa o centro urbano de Jundiaí do OpenStreetMap UMA vez e grava
// blocos prontos em public/map/jundiai/<bbox>.json, no mesmo formato que o jogo lê. O jogo e o APK
// carregam esses arquivos locais: zero download durante o gameplay.
// Uso: node tools/bake-jundiai.mjs   (precisa de internet; leva ~5–15 min)
import fs from 'node:fs';
import path from 'node:path';
import { tileToElements } from '../src/map/VectorTileSource.js';

const OUT = path.resolve(process.env.BAKE_OUT || 'public/map/jundiai');
const CH = 0.004; // tamanho do bloco do jogo (graus) — igual a CONFIG.chunk
const AREA = { south: -23.25, north: -23.12, west: -46.98, east: -46.83 }; // mancha urbana de Jundiaí
const TILE = 0.02; // cada download cobre 5x5 blocos
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const KEEP_TAGS = ['highway', 'name', 'building', 'building:levels', 'height', 'shop', 'amenity', 'leisure', 'landuse', 'natural', 'water', 'railway', 'tunnel', 'parking', 'tourism', 'historic', 'brand'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// Cache dos downloads brutos (um arquivo por área): se o CI cair no meio, a próxima execução continua
// de onde parou em vez de baixar tudo de novo.
const RAW = path.resolve(process.env.BAKE_RAW || '.bake-cache');
const BUDGET = (+(process.env.BAKE_BUDGET_MIN ?? 36)) * 60e3; // tempo máximo de download; depois grava o que tiver
const T0 = Date.now();
const REQ_TIMEOUT = 150e3; // um pedido travado não segura a fila

function query(s, w, n, e) {
  const b = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:120];(way[highway]${b};way[building]${b};relation[building]${b};node[shop][name]${b};node[amenity][name]${b};way[landuse~"industrial|residential|commercial|retail|grass|forest|recreation_ground|reservoir"]${b};way[leisure~"^(park|garden|recreation_ground|playground)$"]${b};way[natural=water]${b};relation[natural=water]${b};relation[leisure=park]${b};way[amenity=parking]${b};way[railway=rail]${b};node[tourism][name]${b};node[historic][name]${b};);out geom;`;
}

// Um pedido a um servidor. Erro de sobrecarga/tempo esgotado → quem chamou divide a área ou tenta outro.
async function fetchArea(server, box) {
  const r = await fetch(server, {
    method: 'POST', body: 'data=' + encodeURIComponent(query(...box)), signal: AbortSignal.timeout(REQ_TIMEOUT),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AutoTheftJundiai-bake/1.1' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 80));
  return j.elements;
}

// Baixa uma área usando o cache; se falhar 2x, divide em 4 pedaços menores (até 2 níveis).
async function area(box, server, depth = 0) {
  const key = box.map((v) => (+v).toFixed(5)).join('_');
  const file = path.join(RAW, key + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() - T0 > BUDGET) return null;
    try {
      const els = await fetchArea(SERVERS[(server + attempt) % SERVERS.length], box);
      fs.writeFileSync(file, JSON.stringify(els));
      return els;
    } catch (err) {
      console.warn(`  ${key} (${SERVERS[(server + attempt) % SERVERS.length]}) → ${err.message}`);
      await sleep(4000 * (attempt + 1));
    }
  }
  if (depth >= 2) return null;
  const [s, w, n, e] = box.map(Number), ms = (s + n) / 2, mw = (w + e) / 2, out = [];
  for (const q of [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]]) {
    const part = await area(q, server + 1, depth + 1);
    if (!part) return null; // área incompleta não entra (o jogo baixa esse pedaço ao vivo)
    out.push(...part);
  }
  return out;
}

function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  return c;
}

const trim = (tags = {}) => Object.fromEntries(Object.entries(tags).filter(([k]) => KEEP_TAGS.includes(k)));
const pts = (el) => (el.geometry || el.members?.flatMap((m) => m.geometry || []) || (el.lat != null ? [{ lat: el.lat, lon: el.lon }] : [])).filter(Boolean);

// RELEVO: blocos Terrarium (altitude SRTM em PNG, AWS Open Data, sem chave) da mancha urbana e do pé da
// Serra do Japi, gravados em public/map/relevo/ — o jogo lê esses arquivos (zero download no jogo).
async function bakeRelevo() {
  const { RELEVO_AREA: A } = await import('../src/render/Terrain.js').catch(() => ({ RELEVO_AREA: { south: -23.27, north: -23.1, west: -47.0, east: -46.81 } }));
  const Z = 13, dir = path.resolve(process.env.BAKE_RELEVO || 'public/map/relevo');
  const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
  const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };
  fs.mkdirSync(dir, { recursive: true });
  let n = 0, kb = 0;
  for (let x = lon2x(A.west); x <= lon2x(A.east); x++) for (let y = lat2y(A.north); y <= lat2y(A.south); y++) {
    const file = path.join(dir, `${Z}_${x}_${y}.png`);
    if (!fs.existsSync(file)) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, { signal: AbortSignal.timeout(30000) });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
          break;
        } catch (e) { console.warn(`  relevo ${x},${y} → ${e.message}`); await sleep(3000 * (attempt + 1)); }
      }
    }
    if (fs.existsSync(file)) { n++; kb += fs.statSync(file).size / 1024; }
  }
  console.log(`relevo: ${n} blocos, ${kb.toFixed(0)} KB em ${path.relative(process.cwd(), dir)}`);
}

async function main() {
  await bakeRelevo();
  if (process.env.BAKE_ONLY === 'relevo') return;
  fs.mkdirSync(OUT, { recursive: true });
  const all = new Map(); // id → elemento (sem duplicar entre downloads)
  const zones = []; // polígonos de landuse para classificar prédios
  const tiles = [];
  for (let s = AREA.south; s < AREA.north - 1e-9; s += TILE) for (let w = AREA.west; w < AREA.east - 1e-9; w += TILE) tiles.push([s, w, s + TILE, w + TILE]);
  fs.mkdirSync(RAW, { recursive: true });
  // um "trabalhador" por servidor Overpass, cada um puxando a próxima área da fila (downloads em paralelo)
  let next = 0, ok = 0, missing = 0, vt = 0;
  const failed = [];
  const take = (els) => {
    for (const el of els) {
      // landuse de zona (indústria/comércio/residencial) só classifica prédios; grama/bosque/represa vão para o mapa
      if (/^(industrial|residential|commercial|retail)$/.test(el.tags?.landuse || '') && el.geometry) { zones.push({ z: el.tags.landuse, p: el.geometry.filter(Boolean).map((g) => [g.lon, g.lat]) }); continue; }
      all.set(el.type[0] + el.id, el);
    }
  };
  await Promise.all(SERVERS.map(async (_, wi) => {
    while (next < tiles.length) {
      const i = next++;
      const els = await area(tiles[i], wi);
      if (els) { take(els); ok++; } else { missing++; failed.push(tiles[i]); }
      console.log(`área ${i + 1}/${tiles.length} ${els ? els.length + ' elementos' : 'FALHOU'} · total ${all.size} · ${((Date.now() - T0) / 60e3).toFixed(1)} min`);
      await sleep(+(process.env.BAKE_PAUSE ?? 1500)); // pausa entre pedidos (respeita o servidor)
    }
  }));
  console.log(`Overpass: ${ok} ok, ${missing} faltando`);
  // PLANO B: as áreas que o Overpass não entregou vêm dos tiles vetoriais da OpenFreeMap (mesmos dados do OSM,
  // servidos por CDN: rápido e sem fila). Têm ruas com nome, prédios com altura, comércios, parques, água e trilhos.
  if (failed.length) {
    let tpl = null;
    try { tpl = (await (await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(20000) })).json()).tiles[0]; } catch (e) { console.warn('OpenFreeMap indisponível:', e.message); }
    const Z = 14, lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
    const lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };
    for (const box of tpl ? failed.splice(0) : []) {
      const [s, w, n, e] = box, key = path.join(RAW, 'vt_' + box.map((v) => v.toFixed(5)).join('_') + '.json');
      let els = fs.existsSync(key) ? JSON.parse(fs.readFileSync(key, 'utf8')) : null;
      if (!els) {
        try {
          els = [];
          for (let x = lon2x(w); x <= lon2x(e); x++) for (let y = lat2y(n); y <= lat2y(s); y++) {
            const r = await fetch(tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(30000) });
            if (!r.ok) throw new Error('tile HTTP ' + r.status);
            els.push(...tileToElements(new Uint8Array(await r.arrayBuffer()), x, y, [s, w, n, e]));
          }
          fs.writeFileSync(key, JSON.stringify(els));
        } catch (err) { console.warn('  tiles vetoriais', box.join(','), '→', err.message); failed.push(box); continue; }
      }
      take(els); missing--; vt++;
    }
    console.log(`OpenFreeMap completou ${vt} áreas`);
  }
  console.log(`downloads: ${ok + vt} ok, ${missing} faltando (esses blocos o jogo baixa ao vivo)`);
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
  let skipped = 0;
  for (const [k, els] of chunks) {
    const [cx, cy] = k.split(',').map(Number);
    // bloco que encosta numa área que falhou ficaria pela metade: não grava (o jogo baixa ao vivo)
    const s0 = cy * CH, w0 = cx * CH;
    if (failed.some(([fs_, fw, fn, fe]) => s0 < fn && s0 + CH > fs_ && w0 < fe && w0 + CH > fw)) { skipped++; continue; }
    const bbox = [cy * CH, cx * CH, (cy + 1) * CH, (cx + 1) * CH].map((v) => v.toFixed(5)).join(',');
    const txt = JSON.stringify({ elements: els });
    bytes += txt.length;
    fs.writeFileSync(path.join(OUT, `${bbox}.json`), txt);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ area: AREA, chunk: CH, complete: missing === 0, missingAreas: missing, chunks: chunks.size - skipped, buildings: [...all.values()].filter((e) => e.tags?.building).length, zoned, bakedAt: new Date().toISOString() }));
  console.log(`blocos pulados por área incompleta: ${skipped}`);
  console.log(`pronto: ${chunks.size - skipped} blocos, ${(bytes / 1e6).toFixed(1)} MB, ${zoned} prédios com zona`);
}
main().catch((e) => { console.error(e); process.exit(1); });
