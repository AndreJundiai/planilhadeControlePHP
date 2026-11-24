// Web Worker (RUNTIME, fora da thread principal): calcula a geometria de um bloco do mapa.
// A tela continua a 60 FPS enquanto isso; o resultado volta como listas de números (sem cópia).
import { computeWorld, MESH_KEYS } from './WorldBuilder.js';
import { Projection } from './Projection.js';

self.onmessage = (e) => {
  const { id, data, lon0, lat0, built } = e.data;
  try {
    const r = computeWorld(data, new Projection(lon0, lat0), new Set(built));
    const transfer = [];
    for (const k of MESH_KEYS) for (const a of Object.values(r[k])) if (a) transfer.push(a.buffer);
    transfer.push(r.trees.buffer, ...r.polys.map((p) => p.buffer));
    self.postMessage({ id, r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
