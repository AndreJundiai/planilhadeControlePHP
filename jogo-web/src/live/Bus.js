import * as THREE from 'three';
import { lerpAngle } from '../core/math.js';
import { makeSign, dist, brl } from './util.js';

/**
 * Linha de ônibus circular passando pela Rua do Retiro, com pontos (abrigo + banco).
 * O ônibus para ~7 s em cada ponto; no ponto, E embarca (tarifa) e no próximo ponto E desce.
 */
const FARE = 4.9, DWELL = 7, SPEED = 9.5, STOP_EVERY = 280;

function busMesh() {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, basic = false) => {
    const m = new THREE.Mesh(geo, basic ? new THREE.MeshBasicMaterial({ color, toneMapped: false }) : new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z); g.add(m); return m;
  };
  add(new THREE.BoxGeometry(2.5, 2.6, 11), 0xf2c12e, 0, 1.75, 0); // carroceria amarela
  add(new THREE.BoxGeometry(2.52, 0.9, 10.2), 0x16202a, 0, 2.3, -0.2); // faixa de janelas
  add(new THREE.BoxGeometry(2.3, 1.3, 0.05), 0x16202a, 0, 2.2, 5.51); // para-brisa
  add(new THREE.BoxGeometry(2.54, 0.35, 11.02), 0x2e8b57, 0, 0.75, 0); // faixa verde
  add(new THREE.BoxGeometry(1.6, 0.35, 0.05), 0x111111, 0, 3.0, 5.52); // letreiro
  for (const x of [-0.8, 0.8]) { add(new THREE.BoxGeometry(0.35, 0.18, 0.05), 0xfff2c0, x, 0.95, 5.52, true); add(new THREE.BoxGeometry(0.35, 0.18, 0.05), 0xff2020, x, 0.95, -5.52, true); }
  for (const [x, z] of [[1.2, 3.6], [-1.2, 3.6], [1.2, -3.4], [-1.2, -3.4]]) {
    const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 14), 0x111111, x, 0.5, z);
    w.rotation.z = Math.PI / 2;
  }
  return g;
}

function shelter() {
  const g = new THREE.Group();
  const m = (geo, c, x, y, z) => { const o = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c })); o.position.set(x, y, z); g.add(o); };
  m(new THREE.BoxGeometry(3, 0.08, 1.4), 0x2e8b57, 0, 2.5, 0); // telhado
  m(new THREE.BoxGeometry(3, 2.4, 0.06), 0x9fb8c8, 0, 1.25, -0.65); // vidro do fundo
  m(new THREE.BoxGeometry(2.4, 0.08, 0.45), 0x8a5a2b, 0, 0.5, -0.35); // banco
  for (const x of [-1.45, 1.45]) m(new THREE.BoxGeometry(0.08, 2.5, 0.08), 0x555555, x, 1.25, -0.6);
  const s = makeSign('Ponto', '#2e8b57', '#fff', 1.4);
  s.position.set(1.7, 2.9, 0.3);
  g.add(s);
  return g;
}

export class Bus {
  constructor(g) {
    this.g = g;
    const G = g.carGraph, start = G.nearest(g.dom.x, g.dom.z);
    const far = G.nodeAtDistance(start.id, 900);
    const go = G.astar(start.id, far.id) || [start.id], back = G.astar(far.id, start.id) || [far.id];
    this.path = go.concat(back.slice(1));
    this.ok = this.path.length > 3;
    this.stops = [];
    this.riding = false;
    if (!this.ok) return;
    // pontos a cada ~280 m ao longo da rota
    let acc = STOP_EVERY;
    for (let i = 0; i < this.path.length - 1; i++) {
      const e = G.edge(this.path[i], this.path[i + 1]);
      acc += e?.len || 0;
      if (acc >= STOP_EVERY && e && e.len > 14) {
        acc = 0;
        const pt = G.pointOn(this.path[i], this.path[i + 1], e.len / 2, 1);
        const sx = pt.x + Math.cos(pt.h) * 3.6, sz = pt.z - Math.sin(pt.h) * 3.6; // na calçada à direita
        const sh = shelter();
        sh.position.set(sx, 0, sz);
        sh.rotation.y = pt.h + Math.PI / 2;
        g.scene.add(sh);
        this.stops.push({ seg: i, t: e.len / 2, x: sx, z: sz, name: G.streetName(pt.x, pt.z) || 'Ponto' });
      }
    }
    this.mesh = busMesh();
    g.scene.add(this.mesh);
    this.seg = 0; this.t = 0; this.speed = 0; this.dwell = 0; this.heading = 0; this.at = null;
    this.pos = this.mesh.position;
    this._place(true);
    this.halfLen = 4.6; this.radius = 1.25; // colisão (cápsula comprida)
  }

  _pose() {
    const G = this.g.carGraph, a = this.path[this.seg], b = this.path[(this.seg + 1) % this.path.length];
    return G.pointOn(a, b, this.t, 1);
  }
  _place(snap) {
    const p = this._pose();
    if (snap) this.pos.set(p.x, 0, p.z);
    else { this.pos.x += (p.x - this.pos.x) * 0.25; this.pos.z += (p.z - this.pos.z) * 0.25; }
    this.heading = snap ? p.h : lerpAngle(this.heading, p.h, 0.12);
    this.mesh.rotation.y = this.heading;
  }

  update(dt) {
    if (!this.ok) return;
    const g = this.g, P = g.player;
    if (this.dwell > 0) {
      this.dwell -= dt;
      this.speed = 0;
    } else {
      // próxima parada neste trecho?
      const stop = this.stops.find((s) => s.seg === this.seg && s.t > this.t);
      const toStop = stop ? stop.t - this.t : Infinity;
      const target = toStop < 18 ? Math.max(1.5, toStop * 0.6) : SPEED;
      this.speed += Math.max(-6 * dt, Math.min(3 * dt, target - this.speed));
      this.t += this.speed * dt;
      if (stop && this.t >= stop.t) { this.t = stop.t; this.dwell = DWELL; this.at = stop; }
      else this.at = null;
      let p = this._pose();
      while (p.len && this.t >= p.len) { this.t -= p.len; this.seg = (this.seg + 1) % (this.path.length - 1); p = this._pose(); }
    }
    this._place(false);
    this.vx = Math.sin(this.heading) * this.speed;
    this.vz = Math.cos(this.heading) * this.speed;
    if (this.riding) { // passageiro: André viaja junto (câmera segue)
      P.mesh.position.set(this.pos.x, 0, this.pos.z);
      P.body.setTranslation({ x: this.pos.x, y: 0.05, z: this.pos.z }, true);
    }
  }

  _stopNear(p, r = 7) { return this.stops.find((s) => dist(p, s) < r); }
  canBoard() { const P = this.g.player; return this.ok && !this.riding && !P.vehicle && this.dwell > 0 && this.at && dist(P.pos, this.at) < 8; }
  canLeave() { return this.riding && this.dwell > 0 && this.at; }

  prompt() {
    if (this.canBoard()) return `[E] Pegar o ônibus (${brl(FARE)})`;
    if (this.canLeave()) return `[E] Descer em ${this.at.name}`;
    if (this.riding) return 'No ônibus — desça no próximo ponto (E)';
    return '';
  }

  interact() {
    const g = this.g, P = g.player;
    if (this.canBoard()) {
      if (P.money < FARE) { g.hud.toast('Dinheiro insuficiente para a passagem', '#ff5050'); return true; }
      P.money -= FARE;
      this.riding = true;
      this.dwell = Math.min(this.dwell, 1.5);
      P.mesh.visible = false;
      P.collider.setEnabled(false);
      g.sound?.cash();
      g.hud.toast(`Passagem paga: ${brl(FARE)}`, '#f2c12e');
      return true;
    }
    if (this.canLeave()) {
      this.riding = false;
      P.mesh.visible = true;
      P.collider.setEnabled(true);
      P.teleport(this.at.x, this.at.z);
      return true;
    }
    return !!this.riding; // dentro do ônibus o E não faz outra coisa
  }

  get markers() {
    if (!this.ok) return [];
    return [{ x: this.pos.x, z: this.pos.z, color: '#f2c12e', r: 7 }, ...this.stops.map((s) => ({ x: s.x, z: s.z, color: '#ffffff', r: 3 }))];
  }
}
