import { makeSign, dist } from './util.js';

/**
 * Casa do André, perto do Dom Olívio. E na porta = dormir: pula para as 7h, recupera a vida e salva.
 * Preso ou desmaiado = acorda em casa e perde 20% do dinheiro.
 */
export class Home {
  constructor(g) {
    this.g = g;
    const d = g.dom, G = g.pedGraph;
    const n = G.nodeAtDistance(G.nearest(d.x, d.z).id, 110);
    const door = g._sidewalk(n);
    this.x = door.x; this.z = door.z;
    const sign = makeSign('Casa do André', '#2e8b57', '#fff', 3.2);
    sign.position.set(this.x, 3.4, this.z);
    g.scene.add(sign);
    this.fade = document.createElement('div');
    this.fade.id = 'fade';
    document.body.appendChild(this.fade);
  }

  near() { return !this.g.player.vehicle && dist(this.g.player.pos, this) < 3.5; }
  prompt() { return this.near() ? '[E] Dormir em casa (até as 7h)' : ''; }

  interact() {
    if (!this.near()) return false;
    this.sleep('Boa noite, André...');
    return true;
  }

  sleep(text) {
    const g = this.g, f = this.fade;
    f.textContent = text;
    f.classList.add('on');
    setTimeout(() => {
      g.clock.skipTo(7);
      g.player.health = 100;
      g.player.teleport(this.x + 1.5, this.z);
      g.save?.();
      f.textContent = `Dia ${g.clock.day} · 07:00`;
      setTimeout(() => f.classList.remove('on'), 1400);
    }, 1300);
  }

  get marker() { return { x: this.x, z: this.z, color: '#2ecc71', r: 7, edge: true }; }
}
