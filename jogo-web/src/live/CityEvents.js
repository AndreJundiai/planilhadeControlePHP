import * as THREE from 'three';
import { Vehicle, CAR_TYPES } from '../player/Vehicle.js';
import { randomLook } from '../entities/Human.js';
import { makeSign, dist, brl } from './util.js';

const COLORS = [0x9b1c1c, 0x1d3f8f, 0xd9d9d9, 0x2d5a3d, 0x1f1f1f, 0xc9b26b];
const lookOf = (kind) => { for (let i = 0; i < 3000; i++) { const l = randomLook(i); if (l.kind === kind) return l; } return randomLook(1); };

/**
 * Eventos na rua do Jundiaí Vivo: acidente (dois carros batidos, curiosos, ambulância) e blitz
 * (viatura parada; passar rápido ou procurado = estrela). Festa da Uva a cada 5 dias (e todo dia
 * em janeiro/fevereiro): barracas, uvas, público e música; E na barraca compra uva.
 */
export class CityEvents {
  constructor(g) {
    this.g = g;
    this.list = [];
    this.nextT = 70;
    this.cars = []; // veículos de evento (entram nas colisões e no "obstáculo à frente" do trânsito)
    this.festa = null;
    this.copLook = lookOf('policial');
  }

  _spawnAcidente(n, street) {
    const g = this.g, e = n.edges[0], h = e ? g.carGraph.pointOn(n.id, e.to, 0, 1).h : 0;
    const a = new Vehicle(COLORS[Math.floor(Math.random() * COLORS.length)], false, CAR_TYPES[Math.floor(Math.random() * 3)]);
    const b = new Vehicle(COLORS[Math.floor(Math.random() * COLORS.length)], false, CAR_TYPES[Math.floor(Math.random() * 3)]);
    a.place(n.x, n.z, h + 0.5);
    b.place(n.x + Math.sin(h) * 4.2, n.z + Math.cos(h) * 4.2, h + 2.3);
    const peds = [0, 1, 2].map((k) => g.npc.spawnStatic(n.x + 4 + k * 0.9, n.z + 3 - k * 0.8, randomLook(100 + k + Math.floor(Math.random() * 50))));
    peds.forEach((p) => { p.mesh.rotation.y = Math.atan2(n.x - p.pos.x, n.z - p.pos.z); });
    g.npc.say(peds[0], 'Nossa, que batida!', 4);
    for (const v of [a, b]) g.scene.add(v.mesh);
    const ev = { type: 'acidente', x: n.x, z: n.z, cars: [a, b], peds, t: 0, ttl: 150, node: n };
    g.hud.toast(`📻 Acidente na ${street}`, '#ffb347');
    return ev;
  }

  _spawnBlitz(n, street) {
    const g = this.g, e = n.edges[0], pt = e ? g.carGraph.pointOn(n.id, e.to, Math.min(5, e.len / 2), 1) : { x: n.x, z: n.z, h: 0 };
    const off = 3.2, cx = pt.x + Math.cos(pt.h) * off, cz = pt.z - Math.sin(pt.h) * off;
    const cop = new Vehicle(0xf4f4f4, true, 'sedan');
    cop.place(cx, cz, pt.h);
    g.scene.add(cop.mesh);
    const officer = g.npc.spawnStatic(cx + Math.sin(pt.h) * 3, cz + Math.cos(pt.h) * 3, this.copLook);
    g.npc.say(officer, 'Blitz! Diminua a velocidade.', 5);
    g.hud.toast(`🚨 Blitz policial na ${street}`, '#9fc3ff');
    return { type: 'blitz', x: cx, z: cz, cars: [cop], peds: [officer], t: 0, ttl: 140, caught: false };
  }

  _remove(ev) {
    for (const v of ev.cars) this.g.scene.remove(v.mesh);
    for (const p of ev.peds) this.g.npc.removeStatic(p);
    ev.amb && this.g.scene.remove(ev.amb.mesh);
  }

  update(dt) {
    const g = this.g, P = g.player, p = P.pos;
    if ((this.nextT -= dt) <= 0 && this.list.length < 2 && g.missions.i >= 1) {
      this.nextT = 90 + Math.random() * 80;
      const n = g.carGraph.randomInRing(p.x, p.z, 110, 260, (q) => g.frustum.containsPoint(g._v.set(q.x, 1, q.z)));
      const street = g.carGraph.streetName(n.x, n.z) || 'cidade';
      this.list.push(Math.random() < 0.55 ? this._spawnAcidente(n, street) : this._spawnBlitz(n, street));
    }
    for (const ev of [...this.list]) {
      ev.t += dt;
      for (const v of ev.cars) if (v.police) v.siren(true, g.time);
      if (ev.type === 'acidente' && !ev.amb && ev.t > 18) { // ambulância chega
        const amb = new Vehicle(0xf6f6f6, true, 'suv');
        amb.place(ev.x - 6, ev.z + 3, Math.random() * 6);
        g.scene.add(amb.mesh);
        ev.amb = amb;
        ev.cars.push(amb);
      }
      if (ev.type === 'blitz' && !ev.caught && P.vehicle && dist(p, ev) < 14) {
        const kmh = Math.abs(P.vehicle.speed) * 3.6;
        if (kmh > 50 || g.wanted.level > 0) { ev.caught = true; g.wanted.add(1, kmh > 50 ? `Passou a ${Math.round(kmh)} km/h na blitz` : 'Reconhecido na blitz'); }
      }
      if (ev.t > ev.ttl || dist(p, ev) > 380) { this._remove(ev); this.list = this.list.filter((x) => x !== ev); }
    }
    this.cars = this.list.flatMap((ev) => ev.cars);
    this._festaUpdate(dt);
  }

  // ---------- Festa da Uva ----------
  get festaDay() { const m = new Date().getMonth(); return m <= 1 || this.g.clock.day % 5 === 0; }

  _festaUpdate() {
    const g = this.g;
    const want = this.festaDay && g.clock.hour >= 9 && g.clock.hour < 23;
    if (want && !this.festa) this._buildFesta();
    if (!want && this.festa) { g.scene.remove(this.festa.group); for (const p of this.festa.peds) g.npc.removeStatic(p); this.festa = null; }
  }

  _buildFesta() {
    const g = this.g, G = g.pedGraph, d = g.dom;
    const n = G.nodeAtDistance(G.nearest(d.x, d.z).id, 320);
    const c = g._sidewalk(n), group = new THREE.Group();
    const cols = [0x6b2d8f, 0x2e8b57, 0xf2f2f2, 0x6b2d8f, 0x2e8b57];
    const tents = [];
    cols.forEach((col, i) => {
      const a = (i / cols.length) * Math.PI * 2, x = c.x + Math.cos(a) * 9, z = c.z + Math.sin(a) * 9;
      const t = new THREE.Group();
      const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.6, 4), new THREE.MeshLambertMaterial({ color: col }));
      top.position.y = 3.1; top.rotation.y = Math.PI / 4;
      const table = new THREE.Mesh(new THREE.BoxGeometry(3, 0.9, 1.2), new THREE.MeshLambertMaterial({ color: 0x8a5a2b }));
      table.position.y = 0.45;
      t.add(top, table);
      for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
        pole.position.set(px, 1.2, pz); t.add(pole);
      }
      for (let k = 0; k < 6; k++) { // cachos de uva na mesa
        const grape = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshLambertMaterial({ color: k % 2 ? 0x4b1f6b : 0x6fae3a }));
        grape.position.set(-1.1 + k * 0.45, 1.0, 0); t.add(grape);
      }
      t.position.set(x, 0, z);
      t.rotation.y = -a + Math.PI / 2;
      group.add(t);
      tents.push({ x, z });
    });
    const sign = makeSign('Festa da Uva', '#6b2d8f', '#fff', 5);
    sign.position.set(c.x, 5.5, c.z);
    group.add(sign);
    g.scene.add(group);
    const peds = Array.from({ length: 8 }, (_, k) => {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 4;
      const p = g.npc.spawnStatic(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, randomLook(300 + k * 7));
      p.mesh.rotation.y = Math.random() * 6;
      return p;
    });
    this.festa = { x: c.x, z: c.z, group, tents, peds };
    g.hud.call('📻 Rádio Jundiaí', 'Hoje tem Festa da Uva! Barracas, uva fresquinha e música perto da Rua do Retiro.');
  }

  festaNear() { const f = this.festa; return f ? Math.max(0, 1 - dist(this.g.player.pos, f) / 70) : 0; }
  _tentNear() { const f = this.festa, p = this.g.player.pos; return f && !this.g.player.vehicle && f.tents.some((t) => dist(p, t) < 3.2); }
  prompt() { return this._tentNear() ? '[E] Comprar uva (R$ 10,00)' : ''; }
  interact() {
    if (!this._tentNear()) return false;
    const P = this.g.player;
    if (P.money < 10) { this.g.hud.toast('Dinheiro insuficiente', '#ff5050'); return true; }
    P.money -= 10;
    P.health = Math.min(100, P.health + 20);
    this.g.sound?.cash();
    this.g.hud.toast(`Uva de Jundiaí! +20 de vida — ${brl(10)}`, '#c39bd3');
    return true;
  }

  markers() {
    const m = this.list.map((ev) => ({ x: ev.x, z: ev.z, color: ev.type === 'blitz' ? '#3060ff' : '#ff9f1a', r: 6 }));
    if (this.festa) m.push({ x: this.festa.x, z: this.festa.z, color: '#9b59b6', r: 8, edge: true });
    return m;
  }
}
