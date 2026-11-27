import { ROADW, DRIVABLE, SPEEDS } from './WorldBuilder.js';

// Grafo leve a partir dos nós reais do OSM + A* / Dijkstra. Cresce conforme os blocos do mapa carregam.
// mode 'car' = vias para veículos (com faixa à direita); 'ped' = calçadas + footways.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

const CELL = 50;

export class RoadGraph {
  // Adiciona um bloco do mapa ao grafo. Os IDs dos nós do OSM são globais,
  // então blocos vizinhos se ligam sozinhos nas ruas que cruzam a divisa.
  addData(data, proj) {
    const mode = this.mode;
    for (const el of data.elements) {
      const hw = el.tags?.highway;
      if (el.type !== 'way' || !hw || !ROADW[hw] || !el.nodes || !el.geometry) continue;
      const drive = DRIVABLE.has(hw), w = ROADW[hw];
      let info;
      if (mode === 'car') {
        if (!drive) continue;
        info = { name: el.tags.name || '', off: Math.max(1.6, w / 4), speed: SPEEDS[hw] || 9 };
      } else {
        if (hw.startsWith('motorway') || hw.startsWith('trunk')) continue;
        info = { name: el.tags.name || '', off: drive ? w / 2 + 1.4 : 0 };
      }
      this.addWay(el.nodes, el.geometry.map((p) => (p ? proj.toXZ(p.lon, p.lat) : null)), info);
    }
  }


  constructor(mode) { this.mode = mode; this.nodes = new Map(); this.grid = new Map(); this.list = []; }

  _node(id, x, z) {
    let n = this.nodes.get(id);
    if (!n) {
      n = { id, x, z, edges: [] };
      this.nodes.set(id, n);
      this.list.push(n);
      const k = this._key(x, z);
      (this.grid.get(k) || this.grid.set(k, []).get(k)).push(n);
    }
    return n;
  }

  addWay(ids, pts, info) {
    for (let i = 0; i < ids.length - 1; i++) {
      if (!pts[i] || !pts[i + 1]) continue;
      const a = this._node(ids[i], ...pts[i]), b = this._node(ids[i + 1], ...pts[i + 1]);
      if (a === b) continue;
      const ex = a.edges.find((e) => e.to === b.id);
      if (ex) { // trecho repetido: só completa o nome, se faltar
        if (!ex.name && info.name) { ex.name = info.name; const back = b.edges.find((e) => e.to === a.id); if (back) back.name = info.name; }
        continue;
      }
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 0.1;
      a.edges.push({ to: b.id, len, ...info });
      b.edges.push({ to: a.id, len, ...info });
    }
  }

  _key(x, z) { return Math.floor(x / CELL) + ',' + Math.floor(z / CELL); }
  get(id) { return this.nodes.get(id); }
  edge(a, b) { return this.nodes.get(a)?.edges.find((e) => e.to === b); }

  nearest(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null, bd = Infinity;
    for (let r = 0; r < 40; r++) {
      for (let i = -r; i <= r; i++) {
        for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          const l = this.grid.get(cx + i + ',' + (cz + j));
          if (l) for (const n of l) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = n; } }
        }
      }
      if (best && Math.sqrt(bd) <= r * CELL) break;
    }
    return best || this.list[0];
  }

  nodesNear(x, z, r) {
    const out = [], R = Math.ceil(r / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const l = this.grid.get(cx + i + ',' + (cz + j)); if (l) out.push(...l); }
    return out;
  }

  // Nó aleatório num anel ao redor de (x,z); `reject` permite descartar nós visíveis pela câmera.
  randomInRing(x, z, rmin, rmax, reject) {
    let fallback = null;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = rmin + Math.random() * (rmax - rmin);
      const n = this.nearest(x + Math.cos(a) * r, z + Math.sin(a) * r);
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < rmin * 0.6) continue;
      fallback = n;
      if (!reject || !reject(n)) return n;
    }
    return fallback || this.nearest(x + rmax, z);
  }

  // maxIt limita a busca: rota de pedestre/trânsito desiste cedo (destino em pedaço desconectado do mapa
  // fazia o A* varrer a cidade inteira e travar o quadro); missões usam o limite grande.
  astar(s, g, maxIt = 30000) {
    if (s === g) return [s];
    const goal = this.nodes.get(g);
    if (!goal || !this.nodes.has(s)) return null;
    const open = new Heap(), gs = new Map([[s, 0]]), came = new Map(), closed = new Set();
    const h = (id) => { const n = this.nodes.get(id); return Math.hypot(n.x - goal.x, n.z - goal.z); };
    open.push(h(s), s);
    for (let it = 0; open.size && it < maxIt; it++) {
      const [, c] = open.pop();
      if (c === g) {
        const p = [c];
        for (let k = c; came.has(k);) { k = came.get(k); p.push(k); }
        return p.reverse();
      }
      if (closed.has(c)) continue;
      closed.add(c);
      const cg = gs.get(c);
      for (const e of this.nodes.get(c).edges) {
        const ng = cg + e.len;
        if (ng < (gs.get(e.to) ?? Infinity)) { gs.set(e.to, ng); came.set(e.to, c); open.push(ng + h(e.to), e.to); }
      }
    }
    return null;
  }

  // Nó cuja distância REAL pelas ruas é a mais próxima de `target` metros.
  nodeAtDistance(s, target) {
    const d = new Map([[s, 0]]), open = new Heap();
    open.push(0, s);
    let best = this.nodes.get(s), bd = Infinity, far = best, fd = 0;
    while (open.size) {
      const [k, c] = open.pop();
      if (k > d.get(c)) continue;
      if (Math.abs(k - target) < bd) { bd = Math.abs(k - target); best = this.nodes.get(c); }
      if (k > fd) { fd = k; far = this.nodes.get(c); }
      if (k > target * 1.3) break;
      for (const e of this.nodes.get(c).edges) {
        const nk = k + e.len;
        if (nk < (d.get(e.to) ?? Infinity)) { d.set(e.to, nk); open.push(nk, e.to); }
      }
    }
    return bd < Infinity ? best : far;
  }

  pathLength(path) {
    let L = 0;
    for (let i = 0; i < path.length - 1; i++) L += this.edge(path[i], path[i + 1])?.len || 0;
    return L;
  }

  // Ponto num trecho a→b, deslocado lateralmente (faixa/calçada). side: +1 direita, -1 esquerda.
  pointOn(aId, bId, t, side = 1) {
    const a = this.nodes.get(aId), b = this.nodes.get(bId);
    if (!b) return { x: a.x, z: a.z, h: 0, len: 0, e: null };
    const e = this.edge(aId, bId), dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 0.1, ux = dx / L, uz = dz / L;
    const off = (e?.off || 0) * side;
    return { x: a.x + ux * t - uz * off, z: a.z + uz * t + ux * off, h: Math.atan2(ux, uz), len: L, e };
  }

  streetName(x, z) {
    const n = this.nearest(x, z);
    let best = '', bd = Infinity;
    for (const e of n?.edges || []) {
      const b = this.nodes.get(e.to), dx = b.x - n.x, dz = b.z - n.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - n.x) * dx + (z - n.z) * dz) / L2));
      const d = (n.x + dx * t - x) ** 2 + (n.z + dz * t - z) ** 2;
      if (d < bd && e.name) { bd = d; best = e.name; }
    }
    return best;
  }
}
