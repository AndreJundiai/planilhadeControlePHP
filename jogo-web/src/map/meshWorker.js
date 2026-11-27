// Web Worker (RUNTIME, fora da thread principal): calcula a geometria de um bloco do mapa
// (prédios, ruas, áreas, árvores) E o mobiliário urbano (postes, semáforos, faixas, lixeiras).
// A tela continua a 60 FPS enquanto isso; o resultado volta como listas de números (sem cópia).
import { computeWorld, MESH_KEYS, insideFromPolys } from './WorldBuilder.js';
import { computeFurniture } from './StreetFurniture.js';
import { Projection } from './Projection.js';

self.onmessage = (e) => {
  const { id, data, lon0, lat0, built, bounds, placed, exclude } = e.data;
  try {
    const proj = new Projection(lon0, lat0);
    const r = computeWorld(data, proj, new Set(built), exclude || []);
    const transfer = [];
    for (const k of MESH_KEYS) for (const a of Object.values(r[k])) if (a) transfer.push(a.buffer);
    transfer.push(r.trees.buffer, ...r.polys.map((p) => p.buffer));
    let f = null;
    if (bounds) {
      const [s, w, n, ea] = bounds;
      const inBounds = (x, z) => { const [lon, lat] = proj.toLonLat(x, z); return lon >= w && lon < ea && lat >= s && lat < n; };
      f = computeFurniture(data, proj, r.ids, new Set(placed), inBounds, insideFromPolys(r.polys));
      for (const k of ['props', 'lamps', 'pools', 'paint', 'lens']) for (const a of Object.values(f[k])) transfer.push(a.buffer);
      transfer.push(f.wires.buffer);
    }
    // os contornos dos prédios também são usados pelo mobiliário: copia antes de transferir
    self.postMessage({ id, r, f }, transfer.filter((b, i, A) => A.indexOf(b) === i));
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
