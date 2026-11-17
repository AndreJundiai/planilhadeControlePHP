import { CONFIG } from '../config.js';
import { loadChunk, fakeChunk } from './OSMLoader.js';
import { buildWorld, disposeWorld } from './WorldBuilder.js';

/**
 * Carrega o mapa em blocos (~420 m) conforme o jogador anda: 3x3 blocos ao redor,
 * descarta os que ficam a mais de 2 blocos. Assim a cidade não "acaba" e não pesa.
 * Ruas entram no grafo de carros/pedestres; paredes viram colisores do Rapier.
 */
export class WorldStreamer {
  constructor(game) {
    this.g = game;
    this.CH = CONFIG.chunk;
    this.chunks = new Map();
    this.queue = [];
    this.busy = false;
    this.built = new Set();
    this.realLoaded = 0;
    this.offline = false;
    this.onProgress = () => {};
  }

  _bounds(cx, cy) { return [cy * this.CH, cx * this.CH, (cy + 1) * this.CH, (cx + 1) * this.CH]; }
  cellOf(x, z) { const [lon, lat] = this.g.proj.toLonLat(x, z); return [Math.floor(lon / this.CH), Math.floor(lat / this.CH)]; }

  // Garante o bloco central carregado (usado no início, com barra de progresso).
  async loadFirst(x, z) {
    const [cx, cy] = this.cellOf(x, z);
    const k = cx + ',' + cy;
    this.chunks.set(k, { cx, cy, state: 'loading' });
    await this._load(k, true);
  }

  update(x, z) {
    const [cx, cy] = this.cellOf(x, z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = cx + dx + ',' + (cy + dy);
        if (!this.chunks.has(k)) { this.chunks.set(k, { cx: cx + dx, cy: cy + dy, state: 'queued' }); this.queue.push(k); }
      }
    }
    for (const [k, c] of this.chunks) {
      if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cy - cy)) <= 2) continue;
      if (c.state === 'ready') this._unload(k, c);
      else if (c.state === 'queued') { this.chunks.delete(k); this.queue = this.queue.filter((q) => q !== k); }
    }
    this.queue.sort((a, b) => {
      const A = this.chunks.get(a), B = this.chunks.get(b);
      return (A.cx - cx) ** 2 + (A.cy - cy) ** 2 - ((B.cx - cx) ** 2 + (B.cy - cy) ** 2);
    });
    if (!this.busy && this.queue.length) this._load(this.queue.shift());
  }

  async _load(k, first = false) {
    const c = this.chunks.get(k);
    if (!c) return;
    this.busy = true;
    c.state = 'loading';
    const bounds = this._bounds(c.cx, c.cy);
    let res = this.offline ? null : await loadChunk(bounds, first ? this.onProgress : undefined);
    if (!res) {
      if (this.realLoaded > 0 && !first) {
        // falha passageira (servidor ocupado): tenta de novo daqui a pouco, sem misturar cidade falsa
        c.state = 'queued';
        this.busy = false;
        setTimeout(() => { if (this.chunks.get(k) === c && !this.queue.includes(k)) this.queue.push(k); }, 6000);
        return;
      }
      this.offline = true;
      res = { data: fakeChunk(bounds), source: 'fallback' };
    }
    if (this.chunks.get(k) === c) this._build(c, res);
    this.busy = false;
    if (!first && this.queue.length) this._load(this.queue.shift());
  }

  _build(c, { data, source }) {
    const g = this.g;
    const w = buildWorld(data, g.proj, this.built);
    g.scene.add(w.group);
    c.world = w;
    c.collider = g.phys.addStatic(w.wallVerts, w.wallIdx);
    w.wallVerts = w.wallIdx = null; // a física já copiou; libera memória
    g.carGraph.addData(data, g.proj);
    g.pedGraph.addData(data, g.proj);
    c.source = source;
    c.state = 'ready';
    if (source !== 'fallback') this.realLoaded++;
  }

  _unload(k, c) {
    this.g.scene.remove(c.world.group);
    disposeWorld(c.world);
    this.g.phys.removeStatic(c.collider);
    for (const id of c.world.ids) this.built.delete(id);
    this.chunks.delete(k);
  }

  insideBuilding(x, z) {
    for (const c of this.chunks.values()) if (c.world?.insideBuilding(x, z)) return true;
    return false;
  }

  get pending() { return this.queue.length + (this.busy ? 1 : 0); }
  get buildings() { let n = 0; for (const c of this.chunks.values()) n += c.world?.stats.buildings || 0; return n; }
}
