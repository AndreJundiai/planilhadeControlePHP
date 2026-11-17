import { CONFIG } from '../config.js';

// Baixa ruas e prédios reais via Overpass API (OpenStreetMap).
// Guarda a resposta no Cache Storage do navegador: na próxima vez abre sem baixar.
export async function loadOSM(lon, lat, radius) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
  const key = `https://osm-cache.local/v1?bbox=${bbox}`;
  let cache = null;
  try {
    cache = await caches.open('jundiai-city-osm');
    const hit = await cache.match(key);
    if (hit) return { data: await hit.json(), source: 'cache' };
  } catch { /* Cache Storage indisponível */ }

  const q = `[out:json][timeout:90];(way[highway](${bbox});way[building](${bbox}););out geom;`;
  for (const url of CONFIG.overpass) {
    try {
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), 60000);
      const r = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: ctl.signal,
      });
      clearTimeout(tm);
      if (!r.ok) continue;
      const txt = await r.text();
      const data = JSON.parse(txt);
      if (data.elements?.length) {
        try { await cache?.put(key, new Response(txt)); } catch { /* sem cache */ }
        return { data, source: 'osm' };
      }
    } catch { /* tenta o próximo servidor */ }
  }
  return { data: fakeCity(lon, lat), source: 'fallback' };
}

// Cidade de teste (grade) no mesmo formato do Overpass, usada quando não há internet.
function fakeCity(lon0, lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110540;
  const ll = (x, z) => ({ lon: lon0 + x / kx, lat: lat0 - z / kz });
  const N = 6, S = 90, els = [];
  const nid = (i, j) => 1e6 + (i + N) * 100 + (j + N);
  const h = (n) => { const x = Math.sin(n * 91.7) * 43758.5; return x - Math.floor(x); };
  for (let i = -N; i <= N; i++) {
    const a = [], ga = [], b = [], gb = [];
    for (let j = -N; j <= N; j++) {
      a.push(nid(j, i)); ga.push(ll(j * S, i * S));
      b.push(nid(i, j)); gb.push(ll(i * S, j * S));
    }
    els.push({ type: 'way', id: 1e5 + i, tags: { highway: i % 3 === 0 ? 'secondary' : 'residential', name: `Rua Teste ${i + N + 1}` }, nodes: a, geometry: ga });
    els.push({ type: 'way', id: 2e5 + i, tags: { highway: i % 3 === 0 ? 'primary' : 'residential', name: `Avenida Teste ${i + N + 1}` }, nodes: b, geometry: gb });
  }
  let k = 0;
  for (let i = -N; i < N; i++) {
    for (let j = -N; j < N; j++) {
      if ((i * 7 + j * 3) % 11 === 0) { // praça com caminho diagonal
        els.push({ type: 'way', id: 4e5 + k++, tags: { highway: 'footway' }, nodes: [nid(i, j), nid(i + 1, j + 1)], geometry: [ll(i * S, j * S), ll((i + 1) * S, (j + 1) * S)] });
        continue;
      }
      for (let a = 0; a < 2; a++) {
        for (let b = 0; b < 2; b++) {
          const x0 = i * S + 11 + a * 35, z0 = j * S + 11 + b * 35, s = 31;
          const lv = 1 + Math.floor(h(++k) * (Math.abs(i) + Math.abs(j) < 4 ? 8 : 3));
          els.push({ type: 'way', id: 3e5 + k, tags: { building: 'yes', 'building:levels': String(lv) },
            geometry: [ll(x0, z0), ll(x0 + s, z0), ll(x0 + s, z0 + s), ll(x0, z0 + s), ll(x0, z0)] });
        }
      }
    }
  }
  return { elements: els };
}
