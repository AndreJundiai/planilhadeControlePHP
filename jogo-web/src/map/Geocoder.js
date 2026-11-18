import { JUNDIAI_BOUNDS, insideJundiai } from '../config.js';

/**
 * Acha um endereço DENTRO de Jundiaí. Tenta Nominatim (OpenStreetMap) e, se falhar, Photon (Komoot).
 * O resultado fica salvo (disco + navegador): só busca na internet uma vez.
 */
const B = JUNDIAI_BOUNDS;

async function nominatim(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&bounded=1&viewbox=${B.west},${B.north},${B.east},${B.south}&q=${encodeURIComponent(q)}`;
  const a = await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json();
  return a[0] ? { lat: +a[0].lat, lon: +a[0].lon, label: a[0].display_name } : null;
}

async function photon(q) {
  const url = `https://photon.komoot.io/api/?limit=1&bbox=${B.west},${B.south},${B.east},${B.north}&q=${encodeURIComponent(q)}`;
  const f = (await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json()).features?.[0];
  return f ? { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: f.properties.name } : null;
}

const KEY = 'geocode-v1';
async function readCache() {
  try { const r = await fetch('./osm-cache/geocode.json'); if (r.ok) return await r.json(); } catch { /* sem servidor */ }
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
async function writeCache(c) {
  const txt = JSON.stringify(c);
  try { localStorage.setItem(KEY, txt); } catch { /* sem localStorage */ }
  try { await fetch('./osm-cache/geocode.json', { method: 'POST', body: txt }); } catch { /* site estático */ }
}

// queries: da mais específica para a mais geral. Retorna { lat, lon, query, source } ou null.
export async function geocode(queries) {
  const cache = await readCache();
  for (const q of queries) if (cache[q]) return { ...cache[q], query: q, source: 'cache' };
  for (const q of queries) {
    for (const [fn, name] of [[nominatim, 'nominatim'], [photon, 'photon']]) {
      try {
        const r = await fn(q);
        if (r && insideJundiai(r.lat, r.lon)) {
          cache[q] = { lat: r.lat, lon: r.lon, label: r.label };
          await writeCache(cache);
          return { ...cache[q], query: q, source: name };
        }
      } catch { /* tenta a próxima fonte */ }
    }
  }
  return null;
}
