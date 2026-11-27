import { CONFIG, JUNDIAI_BOUNDS } from '../config.js';
import { loadChunk, fakeChunk } from './OSMLoader.js';
import { computeWorld, assembleWorld, disposeWorld, insideFromPolys } from './WorldBuilder.js';
import { nextFrame } from '../core/math.js';
import { computeFurniture, assembleFurniture, disposeFurniture } from './StreetFurniture.js';

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
    this.places = []; // comércios com nome achados nos blocos (lojas, mercados...)
    this.placedNodes = new Set(); // cruzamentos que já receberam faixa/semáforo
    // geometria calculada num Web Worker (sem travar a tela); se não houver Worker, calcula aqui mesmo
    this.jobs = new Map();
    this.jobId = 0;
    try {
      this.worker = new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => { const j = this.jobs.get(e.data.id); this.jobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve({ r: e.data.r, f: e.data.f }); };
    } catch { this.worker = null; }
    this._placeKeys = new Set();
    this.exclude = []; // áreas com prédio modelado à mão (Dom Olívio): o mapa genérico não constrói ali
  }

  /**
   * Marca uma área para prédio modelado e reconstrói os blocos que encostam nela (usado uma vez,
   * atrás da tela de título). Resolve quando os blocos estiverem prontos de novo.
   */
  async excludeArea(R) {
    this.exclude.push(R);
    const ext = Math.hypot(R.hw, R.hd), keys = new Set();
    for (const [dx, dz] of [[0, 0], [ext, ext], [-ext, ext], [ext, -ext], [-ext, -ext]]) { const [cx, cy] = this.cellOf(R.cx + dx, R.cz + dz); keys.add(cx + ',' + cy); }
    for (const k of keys) {
      const c = this.chunks.get(k);
      if (c?.state === 'ready') { this._unload(k, c); this.chunks.set(k, { cx: c.cx, cy: c.cy, state: 'queued' }); this.queue.unshift(k); }
    }
    if (!this.busy && this.queue.length) this._load(this.queue.shift());
    for (let t = 0; t < 600 && [...keys].some((k) => this.chunks.has(k) && this.chunks.get(k).state !== 'ready'); t++) {
      if (!this.busy && this.queue.length) this._load(this.queue.shift());
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // Só Jundiaí: blocos fora do município não são carregados.
  _inside(cx, cy) {
    const [s, w, n, e] = this._bounds(cx, cy), B = JUNDIAI_BOUNDS;
    return n >= B.south && s <= B.north && e >= B.west && w <= B.east;
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
        if (this.chunks.has(k) || !this._inside(cx + dx, cy + dy)) continue;
        this.chunks.set(k, { cx: cx + dx, cy: cy + dy, state: 'queued' });
        this.queue.push(k);
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
    if (first) this.skipFirst = new AbortController(); // botão "Jogar agora" na tela de carregamento
    let res = this.offline ? null : await loadChunk(bounds, first ? this.onProgress : undefined, first ? this.skipFirst.signal : null);
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
    if (this.chunks.get(k) === c) await this._build(c, res);
    this.busy = false;
    if (!first && this.queue.length) this._load(this.queue.shift());
  }

  // prédios + mobiliário urbano do bloco, no Worker (ou aqui mesmo, se não houver Worker)
  _compute(data, bounds, inBounds) {
    const g = this.g;
    const sync = () => {
      const r = computeWorld(data, g.proj, this.built, this.exclude);
      const f = computeFurniture(data, g.proj, r.ids, new Set(this.placedNodes), inBounds, insideFromPolys(r.polys));
      return { r, f };
    };
    if (!this.worker) return Promise.resolve(sync());
    const id = ++this.jobId;
    return new Promise((resolve, reject) => {
      this.jobs.set(id, { resolve, reject });
      this.worker.postMessage({ id, data, lon0: g.proj.lon0, lat0: g.proj.lat0, built: [...this.built], bounds, placed: [...this.placedNodes], exclude: this.exclude });
    }).catch(sync); // Worker falhou: faz na thread principal
  }

  // Montagem em etapas, um quadro para cada: geometria (Worker) → malhas → mobiliário → colisão e rotas
  async _build(c, { data, source }) {
    const g = this.g, T = (this.buildStats ??= []), st = {}, now = () => performance.now();
    let t = now();
    const [s, west, n, e] = this._bounds(c.cx, c.cy);
    const inBounds = (x, z) => { const [lon, lat] = g.proj.toLonLat(x, z); return lon >= west && lon < e && lat >= s && lat < n; };
    const { r, f } = await this._compute(data, [s, west, n, e], inBounds);
    st.worker = now() - t;
    for (const id of r.ids) this.built.add(id);
    t = now();
    const w = assembleWorld(r);
    st.assemble = now() - t;
    g.scene.add(w.group);
    c.world = w;
    await nextFrame();
    // mobiliário urbano (calculado no Worker): postes, semáforos, faixas de pedestre, lixeiras, hidrantes
    t = now();
    for (const id of f.myNodes) this.placedNodes.add(id);
    c.furn = assembleFurniture(f);
    st.furniture = now() - t;
    g.scene.add(c.furn.group);
    const [cxm, czm] = g.proj.toXZ((west + e) / 2, (s + n) / 2);
    c.center = { x: cxm, z: czm };
    await nextFrame();
    t = now();
    c.collider = g.phys.addStatic(w.wallVerts, w.wallIdx);
    st.physics = now() - t;
    t = now();
    w.wallVerts = w.wallIdx = null; // a física já copiou; libera memória
    this._collectPlaces(data);
    g.carGraph.addData(data, g.proj);
    g.pedGraph.addData(data, g.proj);
    st.graphs = now() - t;
    t = now();
    g.landmarks?.scan(); // letreiros de mercados e pontos turísticos deste bloco
    st.landmarks = now() - t;
    T.push(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, +v.toFixed(1)])));
    if (T.length > 30) T.shift();
    c.source = source;
    c.state = 'ready';
    if (source !== 'fallback') this.realLoaded++;
  }

  _collectPlaces(data) {
    for (const el of data.elements) {
      const t = el.tags;
      if (!t?.name || !(t.shop || t.amenity || t.building || t.leisure || t.tourism || t.historic || t.railway === 'station')) continue;
      let lat = el.lat, lon = el.lon;
      if (lat == null && el.geometry?.length) {
        const g = el.geometry.filter(Boolean);
        lat = g.reduce((a, p) => a + p.lat, 0) / g.length;
        lon = g.reduce((a, p) => a + p.lon, 0) / g.length;
      }
      if (lat == null) continue;
      const [x, z] = this.g.proj.toXZ(lon, lat), key = t.name + Math.round(x / 20) + ',' + Math.round(z / 20);
      if (this._placeKeys.has(key)) continue;
      this._placeKeys.add(key);
      this.places.push({ name: t.name, x, z, kind: t.shop || t.amenity || t.leisure || t.tourism || t.historic || 'building' });
    }
  }

  _unload(k, c) {
    this.g.scene.remove(c.world.group);
    disposeWorld(c.world);
    if (c.furn) { this.g.scene.remove(c.furn.group); disposeFurniture(c.furn, this.placedNodes); }
    this.g.phys.removeStatic(c.collider);
    for (const id of c.world.ids) this.built.delete(id);
    this.chunks.delete(k);
  }

  insideBuilding(x, z) {
    for (const c of this.chunks.values()) if (c.world?.insideBuilding(x, z)) return true;
    return false;
  }

  // semáforos dos blocos perto do jogador (os carros param no vermelho)
  nearbyLights(x, z, r) {
    const out = [];
    for (const c of this.chunks.values()) {
      if (!c.furn || Math.hypot(c.center.x - x, c.center.z - z) > r + 300) continue;
      for (const L of c.furn.lights) if (Math.hypot(L.x - x, L.z - z) < r) out.push(L);
    }
    return out;
  }

  // as N luminárias mais perto (recebem as luzes pontuais reais à noite)
  nearbyLamps(x, z, n, r = 90) {
    const out = [];
    for (const c of this.chunks.values()) {
      if (!c.furn?.lamps || Math.hypot(c.center.x - x, c.center.z - z) > r + 300) continue;
      const L = c.furn.lamps;
      for (let i = 0; i < L.length; i += 2) { const d = Math.hypot(L[i] - x, L[i + 1] - z); if (d < r) out.push([d, L[i], L[i + 1]]); }
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, n);
  }

  // LOD por bloco (a cada 0,4 s):
  //  - mobiliário urbano só perto;
  //  - fachada com janelas perto (LOD0), parede simples longe (LOD1, shader barato);
  //  - árvores, trilhos e estacionamentos somem longe (a névoa já os esconderia);
  //  - SÓ os blocos perto projetam sombra: o passe de sombra deixa de desenhar o mapa inteiro.
  updateLOD(x, z, range = 330, shadowRange = 240) {
    for (const c of this.chunks.values()) {
      if (!c.furn || !c.world) continue;
      const d = Math.hypot(c.center.x - x, c.center.z - z);
      c.furn.group.visible = d < range;
      for (const m of c.world.group.children) {
        if (m.userData.lod) m.material = d < 260 ? m.userData.lod.near : m.userData.lod.far;
        if (m.userData.detail) m.visible = d < range;
        if (m.userData.caster) m.castShadow = d < shadowRange;
      }
    }
  }

  get pending() { return this.queue.length + (this.busy ? 1 : 0); }
  get buildings() { let n = 0; for (const c of this.chunks.values()) n += c.world?.stats.buildings || 0; return n; }
}
