import { makeBeacon, dist, brl } from './util.js';

/**
 * Emprego de entregas (app no celular): retira num comércio real do mapa, entrega em outro.
 * Prazo pela distância; à noite paga 50% a mais; atrasou = metade; muito atrasado = cancelada.
 */
export class Jobs {
  constructor(g) {
    this.g = g;
    this.offer = null;
    this.job = null;
    this.nextOffer = 20;
    this.done = 0;
    this.beacon = makeBeacon(g.scene, 0x3fa9ff);
  }

  _spot(near, rmin, rmax) {
    const P = this.g.streamer.places.filter((p) => { const d = Math.hypot(p.x - near.x, p.z - near.z); return d > rmin && d < rmax; });
    if (P.length) { const p = P[Math.floor(Math.random() * P.length)]; return { x: p.x, z: p.z, name: p.name }; }
    const n = this.g.carGraph.randomInRing(near.x, near.z, rmin, rmax);
    return { x: n.x, z: n.z, name: this.g.carGraph.streetName(n.x, n.z) || 'endereço no mapa' };
  }

  _makeOffer() {
    const g = this.g, p = g.player.pos;
    const pickup = this._spot(p, 120, 600), drop = this._spot(pickup, 450, 1500);
    const km = (dist(pickup, drop) * 1.3) / 1000;
    const pay = Math.round((16 + km * 14) * (g.night ? 1.5 : 1));
    this.offer = { pickup, drop, pay, deadline: Math.round(45 + (km * 1000) / 9), offerT: 30 };
    g.hud.call('📦 App de Entregas', `Retirar em ${pickup.name} e levar para ${drop.name} (${km.toFixed(1)} km) — ${brl(pay)}${g.night ? ' (adicional noturno)' : ''}. Aperte J (📦) para aceitar.`);
  }

  accept() {
    if (!this.offer || this.job) return false;
    this.job = { ...this.offer, stage: 'pickup' };
    this.offer = null;
    this.g.hud.toast('Entrega aceita — vá retirar o pacote', '#3fa9ff');
    return true;
  }

  // só depois da primeira missão (compras no Dom), e não durante prisão/desmaio
  update(dt) {
    const g = this.g;
    if (g.missions.i < 1 || g.dead) { this.beacon.hide(); return; }
    if (!this.job && !this.offer && (this.nextOffer -= dt) <= 0) this._makeOffer();
    if (this.offer && (this.offer.offerT -= dt) <= 0) { this.offer = null; this.nextOffer = 40; }
    const j = this.job;
    if (!j) { this.beacon.hide(); return; }
    const p = g.player.pos;
    if (j.stage === 'pickup') {
      this.beacon.at(j.pickup.x, j.pickup.z);
      if (dist(p, j.pickup) < 8) { j.stage = 'drop'; j.timer = j.deadline; g.hud.toast(`Pacote coletado! Leve para ${j.drop.name}`, '#3fa9ff'); g.sound?.cash(); }
      return;
    }
    this.beacon.at(j.drop.x, j.drop.z);
    j.timer -= dt;
    if (dist(p, j.drop) < 8) {
      const late = j.timer < 0, pay = late ? Math.round(j.pay / 2) : j.pay;
      g.player.money += pay;
      g.sound?.cash();
      g.hud.toast(`Entrega feita${late ? ' com atraso' : ''}: +${brl(pay)}`, late ? '#ffb347' : '#7dff7d');
      this.done++;
      this.job = null;
      this.nextOffer = 25 + Math.random() * 30;
      g.save?.();
    } else if (j.timer < -j.deadline) {
      g.hud.toast('Entrega cancelada (atrasou demais)', '#ff5050');
      this.job = null;
      this.nextOffer = 40;
    }
  }

  get line() {
    const j = this.job, o = this.offer;
    if (o) return `📦 Nova entrega: ${brl(o.pay)} — J para aceitar (${Math.ceil(o.offerT)} s)`;
    if (!j) return '';
    if (j.stage === 'pickup') return `📦 Retire o pacote em ${j.pickup.name} (${Math.round(dist(this.g.player.pos, j.pickup))} m)`;
    const t = Math.ceil(j.timer), s = t < 0 ? `atrasado ${-t} s` : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    return `📦 Entregue em ${j.drop.name} (${Math.round(dist(this.g.player.pos, j.drop))} m) · ${s}`;
  }

  get marker() {
    const j = this.job;
    if (!j) return null;
    const m = j.stage === 'pickup' ? j.pickup : j.drop;
    return { x: m.x, z: m.z, color: '#3fa9ff', r: 8, edge: true };
  }
}
