import { CONFIG } from '../config.js';
import { loadFromVectorTiles } from './VectorTileSource.js';

// Baixa um BLOCO do mapa (ruas + prédios reais) via Overpass API do OpenStreetMap.
// Cada bloco fica salvo para sempre (disco + navegador): na próxima vez abre sem baixar.
async function readWithProgress(r, onProgress) {
  let last = 0;
  try { last = +localStorage.getItem('osm-chunk-size'); } catch { /* sem localStorage */ }
  const total = +r.headers.get('content-length') || last || 1.5e6; // Overpass quase nunca informa o tamanho
  const reader = r.body?.getReader();
  if (!reader) return r.text();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(0.99, got / total), got);
  }
  try { localStorage.setItem('osm-chunk-size', String(got)); } catch { /* sem localStorage */ }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

// ---------- armazenamento permanente ----------
// 1º disco (pasta osm-cache/ do projeto, via servidor do Vite) · 2º IndexedDB do navegador.
const DB = 'jundiai-city', STORE = 'osm';
function idb() {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
async function idbGet(key) {
  try { const db = await idb(); return await new Promise((ok) => { const q = db.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch { return null; }
}
async function idbPut(key, txt) {
  try { const db = await idb(); db.transaction(STORE, 'readwrite').objectStore(STORE).put(txt, key); } catch { /* sem IndexedDB */ }
}
async function diskGet(name) {
  try { const r = await fetch('./osm-cache/' + name); return r.ok ? await r.text() : null; } catch { return null; }
}
async function diskPut(name, txt) {
  try { await fetch('./osm-cache/' + name, { method: 'POST', body: txt }); } catch { /* site estático: só IndexedDB */ }
}

// bounds = [sul, oeste, norte, leste]. Retorna { data, source } ou null se todos os servidores falharem.
// Cada bloco é baixado UMA vez: depois vem do disco ou do navegador.
export async function loadChunk(bounds, onProgress = () => {}, cancel = null) {
  const bbox = bounds.map((v) => v.toFixed(5)).join(',');
  const name = `${bbox}.json`;
  // 1º mapa PRÉ-PROCESSADO que vem junto do jogo/APK (tools/bake-jundiai.mjs): zero download
  if (!new URLSearchParams(location.search).has('mapa')) {
    try {
      const r = await fetch('./map/jundiai/' + name);
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) { const data = await r.json(); onProgress('cache', 1, 0); return { data, source: 'baked' }; }
    } catch { /* bloco fora da área pré-processada */ }
  }
  for (const [get, src] of [[diskGet, 'disk'], [idbGet, 'browser']]) {
    const txt = await get(src === 'disk' ? name : bbox);
    if (txt) {
      try {
        const data = JSON.parse(txt);
        onProgress('cache', 1, 0);
        if (src === 'browser') diskPut(name, txt); // copia para o disco também
        return { data, source: 'cache' };
      } catch { /* arquivo corrompido: baixa de novo */ }
    }
  }

  // ruas, prédios e comércios com nome (lojas, mercados, padarias...)
  const q = `[out:json][timeout:25];(way[highway](${bbox});way[building](${bbox});relation[building](${bbox});node[shop][name](${bbox});node[amenity][name](${bbox});way[leisure~"^(park|garden|recreation_ground|playground)$"](${bbox});way[natural=water](${bbox});way[landuse~"^(grass|forest|recreation_ground|reservoir)$"](${bbox});way[amenity=parking](${bbox});way[railway=rail](${bbox});node[tourism][name](${bbox});node[historic][name](${bbox}););out geom;`;
  const win = await race(bounds, q, onProgress, cancel);
  if (!win) return null;
  diskPut(name, win.txt);
  idbPut(bbox, win.txt);
  return { data: win.data, source: win.source };
}

// Um servidor Overpass: baixa e confere o JSON.
async function fromOverpass(url, q, signal, onBytes) {
  const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const txt = await readWithProgress(r, onBytes);
  const data = JSON.parse(txt);
  if (!Array.isArray(data.elements)) throw new Error('resposta inválida');
  return { txt, data, source: 'osm' };
}

/**
 * Corrida entre servidores: começa pelo 1º; se ele não responder em alguns segundos (ou falhar),
 * o próximo entra junto — inclusive o plano B (OpenFreeMap). O primeiro que terminar vence e os outros são cancelados.
 * Sem nenhuma resposta em ~50 s (ou se o jogador apertar "Jogar agora"), desiste e retorna null.
 */
const STAGGER = 5000, GIVE_UP = 50000;
function race(bounds, q, onProgress, cancel) {
  const sources = [
    ...CONFIG.overpass.map((url, i) => ({ label: `OpenStreetMap (servidor ${i + 1})`, run: (sig, onB) => fromOverpass(url, q, sig, onB) })),
    { label: 'OpenFreeMap (plano B)', run: async (sig) => { const data = await loadFromVectorTiles(bounds, sig); if (!data.elements.length) throw new Error('vazio'); return { txt: JSON.stringify(data), data, source: 'tiles' }; } },
  ];
  return new Promise((resolve) => {
    const ctl = new AbortController(), t0 = Date.now();
    let next = 0, failed = 0, done = false, downloading = false, timer = null, deadline = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(deadline); clearInterval(tick);
      ctl.abort();
      resolve(v);
    };
    const armDeadline = () => { clearTimeout(deadline); deadline = setTimeout(() => finish(null), GIVE_UP); };
    const tick = setInterval(() => { if (!downloading) onProgress('wait', 0, 0, { label: sources[Math.max(0, next - 1)].label, tried: next, total: sources.length, secs: Math.round((Date.now() - t0) / 1000) }); }, 500);
    const launch = () => {
      clearTimeout(timer);
      if (done || next >= sources.length) return;
      const s = sources[next++];
      s.run(ctl.signal, (f, bytes) => { downloading = true; armDeadline(); onProgress('download', f, bytes, { label: s.label }); })
        .then((v) => { onProgress('download', 1, v.txt.length, { label: s.label }); finish(v); })
        .catch(() => { if (done) return; if (++failed >= sources.length) finish(null); else launch(); }); // falhou: chama o próximo já
      timer = setTimeout(launch, STAGGER);
    };
    cancel?.addEventListener('abort', () => finish(null));
    armDeadline();
    launch();
  });
}

// Bloco de teste (grade de ruas a cada 90 m) no formato do Overpass, para jogar sem internet.
// Usa uma grade GLOBAL: blocos vizinhos se encaixam e compartilham os mesmos nós.
export function fakeChunk([s, w, n, e]) {
  const S = 90, dLat = S / 110540, dLon = S / (111320 * Math.cos((-23.19 * Math.PI) / 180));
  const i0 = Math.floor(w / dLon), i1 = Math.ceil(e / dLon), j0 = Math.floor(s / dLat), j1 = Math.ceil(n / dLat);
  const nid = (i, j) => `g${i}_${j}`, ll = (i, j) => ({ lon: i * dLon, lat: j * dLat });
  const h = (a, b) => { const x = Math.sin(a * 91.7 + b * 47.3) * 43758.5; return x - Math.floor(x); };
  const els = [];
  for (let j = j0; j <= j1; j++) {
    const ids = [], geo = [];
    for (let i = i0; i <= i1; i++) { ids.push(nid(i, j)); geo.push(ll(i, j)); }
    els.push({ type: 'way', id: `fr${j}_${i0}`, tags: { highway: j % 4 === 0 ? 'secondary' : 'residential', name: `Rua Teste ${((j % 60) + 60) % 60}` }, nodes: ids, geometry: geo });
  }
  for (let i = i0; i <= i1; i++) {
    const ids = [], geo = [];
    for (let j = j0; j <= j1; j++) { ids.push(nid(i, j)); geo.push(ll(i, j)); }
    els.push({ type: 'way', id: `fc${i}_${j0}`, tags: { highway: i % 4 === 0 ? 'primary' : 'residential', name: `Avenida Teste ${((i % 60) + 60) % 60}` }, nodes: ids, geometry: geo });
  }
  const mLat = 11 / 110540, mLon = (11 / S) * dLon, lotLat = (dLat - 2 * mLat - 4 / 110540) / 2, lotLon = (dLon - 2 * mLon - (4 / S) * dLon) / 2;
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const cLon = (i + 0.5) * dLon, cLat = (j + 0.5) * dLat;
      if (cLon < w || cLon >= e || cLat < s || cLat >= n) continue; // cada quarteirão pertence a um só bloco
      if (h(i, j) < 0.09) {
        els.push({ type: 'way', id: `fp${i}_${j}`, tags: { highway: 'footway' }, nodes: [nid(i, j), nid(i + 1, j + 1)], geometry: [ll(i, j), ll(i + 1, j + 1)] });
        continue;
      }
      const lo0 = i * dLon + mLon, la0 = j * dLat + mLat, lo1 = (i + 1) * dLon - mLon, la1 = (j + 1) * dLat - mLat;
      const rect = (a, b, c, d) => [{ lat: b, lon: a }, { lat: b, lon: c }, { lat: d, lon: c }, { lat: d, lon: a }, { lat: b, lon: a }];
      if (h(i, j) < 0.15) { // praça com lago
        els.push({ type: 'way', id: `fk${i}_${j}`, tags: { leisure: 'park', name: 'Praça Teste' }, geometry: rect(lo0, la0, lo1, la1) });
        const cx = (lo0 + lo1) / 2, cy = (la0 + la1) / 2, rx = (lo1 - lo0) * 0.22, ry = (la1 - la0) * 0.22;
        els.push({ type: 'way', id: `fw${i}_${j}`, tags: { natural: 'water' }, geometry: rect(cx - rx, cy - ry, cx + rx, cy + ry) });
        continue;
      }
      if (h(i, j) < 0.2) { // supermercado com estacionamento
        const names = ['Supermercado Tauste', 'Boa Supermercados', 'Coopercica', 'Roldão Atacadista', 'Assaí Atacadista'];
        const mid = (lo0 + lo1) / 2, nm = names[Math.floor(h(j, i) * names.length)];
        els.push({ type: 'way', id: `fs${i}_${j}`, tags: { building: 'supermarket', shop: 'supermarket', name: nm, 'building:levels': '2' }, geometry: rect(lo0, la0, mid, la1) });
        els.push({ type: 'way', id: `fl${i}_${j}`, tags: { amenity: 'parking' }, geometry: rect(mid + mLon * 0.2, la0, lo1, la1) });
        els.push({ type: 'node', id: `fn${i}_${j}`, tags: { shop: 'supermarket', name: nm }, lat: (la0 + la1) / 2, lon: (lo0 + mid) / 2 });
        continue;
      }
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const lo = i * dLon + mLon + a * (lotLon + (4 / S) * dLon), la = j * dLat + mLat + b * (lotLat + 4 / 110540);
          const lv = 1 + Math.floor(h(i * 2 + a, j * 2 + b) * (h(i, j) > 0.8 ? 9 : 3));
          els.push({ type: 'way', id: `fb${i}_${j}_${a}${b}`, tags: { building: 'yes', 'building:levels': String(lv) },
            geometry: [{ lat: la, lon: lo }, { lat: la, lon: lo + lotLon }, { lat: la + lotLat, lon: lo + lotLon }, { lat: la + lotLat, lon: lo }, { lat: la, lon: lo }] });
        }
      }
    }
  }
  return { elements: els };
}
