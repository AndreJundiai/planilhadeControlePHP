import { CONFIG } from '../config.js';

// Baixa um BLOCO do mapa (ruas + prédios reais) via Overpass API do OpenStreetMap.
// Cada bloco fica no Cache Storage do navegador: na próxima vez abre sem baixar.
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

// bounds = [sul, oeste, norte, leste]. Retorna { data, source } ou null se todos os servidores falharem.
export async function loadChunk(bounds, onProgress = () => {}) {
  const bbox = bounds.map((v) => v.toFixed(5)).join(',');
  const key = `https://osm-cache.local/v2?bbox=${bbox}`;
  let cache = null;
  try {
    cache = await caches.open('jundiai-city-osm');
    const hit = await cache.match(key);
    if (hit) { onProgress('cache', 1, 0); return { data: await hit.json(), source: 'cache' }; }
  } catch { /* Cache Storage indisponível */ }

  const q = `[out:json][timeout:60];(way[highway](${bbox});way[building](${bbox});relation[building](${bbox}););out geom;`;
  for (const url of CONFIG.overpass) {
    onProgress('wait', 0, 0);
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 45000);
      const r = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctl.signal,
      });
      if (!r.ok) { clearTimeout(tm); continue; }
      const txt = await readWithProgress(r, (f, bytes) => onProgress('download', f, bytes));
      clearTimeout(tm);
      onProgress('download', 1, txt.length);
      const data = JSON.parse(txt);
      if (Array.isArray(data.elements)) {
        try { await cache?.put(key, new Response(txt)); } catch { /* sem cache */ }
        return { data, source: 'osm' };
      }
    } catch { /* tenta o próximo servidor */ }
  }
  return null;
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
