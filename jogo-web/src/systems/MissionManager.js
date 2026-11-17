import * as THREE from 'three';
import { Vehicle } from '../player/Vehicle.js';

/**
 * Gerenciador de missões. Cada missão tem start/update/cleanup (+ interact opcional).
 * Os pontos vêm do grafo real do OSM: distâncias medidas pelas ruas, não em linha reta.
 */
const MISSIONS = [
  {
    title: 'O Recado na Esquina',
    start(m) {
      const g = m.g, p = g.player.pos;
      const s = g.pedGraph.nearest(p.x, p.z);
      const goal = g.pedGraph.nodeAtDistance(s.id, 300);
      m.d.goal = goal;
      m.d.contact = g.npc.spawnStatic(goal.x + 1.2, goal.z + 1.2);
      m.timer = 150;
      m.setMarker(goal.x, goal.z, '#ffd400');
      g.hud.call('Número desconhecido', 'André, tenho um serviço pra você. Meu contato está numa esquina a uns 300 metros. Vá A PÉ e não demore!');
      m.objective = 'Vá a pé até o contato (marcador amarelo)';
    },
    update(m) {
      const g = m.g, P = g.player, c = m.d.contact.pos;
      const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
      m.objective = P.vehicle ? 'Saia do veículo — o contato quer você A PÉ' : `Vá a pé até o contato (${Math.round(d)} m)`;
      if (!P.vehicle && d < 3) {
        g.npc.say(m.d.contact, 'Toma essa maleta. Leve ao ponto de entrega e não abra!', 5);
        P.hasBriefcase = true;
        m.complete();
      }
    },
    cleanup(m) { if (m.failed) m.g.npc.removeStatic(m.d.contact); else m.g.lastContact = m.d.contact; },
  },
  {
    title: 'Entrega Sob Pressão',
    start(m) {
      const g = m.g, p = g.player.pos;
      g.player.hasBriefcase = true;
      const cn = g.carGraph.nearest(p.x, p.z);
      const near = g.carGraph.nodeAtDistance(cn.id, 35);
      const car = new Vehicle(0x2a7bd4);
      g.placeOnRoad(car, near);
      g.scene.add(car.mesh);
      g.parked.push(car);
      m.d.car = car;
      m.d.dest = g.carGraph.nodeAtDistance(near.id, 1500);
      m.d.startDist = null;
      m.d.cops = false;
      g.hud.call('Número desconhecido', 'Tem um carro azul estacionado perto de você. Leve a maleta até o ponto de entrega, uns 1,5 km pelas avenidas.');
    },
    update(m) {
      const g = m.g, P = g.player, dest = m.d.dest;
      if (!P.vehicle) {
        const c = m.d.car.pos;
        m.setMarker(c.x, c.z, '#3fa9ff');
        m.objective = 'Pegue o carro azul estacionado (ou roube um carro) — tecla E';
        return;
      }
      const d = Math.hypot(P.pos.x - dest.x, P.pos.z - dest.z);
      if (m.d.startDist === null) m.d.startDist = d;
      m.setMarker(dest.x, dest.z, '#ffd400');
      m.objective = `Leve a maleta ao ponto de entrega (${Math.round(d)} m)`;
      if (!m.d.cops && d < m.d.startDist * 0.55) {
        m.d.cops = true;
        g.wanted.set(1, 'Uma viatura viu a maleta!');
      }
      if (g.wanted.level > 0) m.objective = 'Despiste a polícia antes da entrega! (fique longe das viaturas)';
      if (d < 9 && g.wanted.level === 0) {
        P.hasBriefcase = false;
        g.hud.call('Número desconhecido', 'Entrega feita. Bom trabalho, André.');
        m.complete();
      }
    },
    cleanup() {},
  },
  {
    title: 'Interceptação Estratégica',
    start(m) {
      const g = m.g, p = g.player.pos, G = g.carGraph;
      const s = G.nearest(p.x, p.z);
      const A = G.nodeAtDistance(s.id, 300), B = G.nodeAtDistance(A.id, 450);
      const go = G.astar(A.id, B.id) || [A.id], back = G.astar(B.id, A.id) || [B.id];
      const loop = go.concat(back.slice(1));
      m.d.target = g.traffic.addTarget(loop.length > 2 ? loop : [A.id, A.edges[0].to, A.id]);
      g.hud.call('Número desconhecido', 'Um carro AMARELO está rodando no bairro com um item nosso. Feche a passagem dele com o seu carro, sem destruí-lo.');
    },
    update(m) {
      const g = m.g, t = m.d.target, P = g.player;
      m.setMarker(t.v.pos.x, t.v.pos.z, '#f5c400');
      if (t.v.health <= 0) return m.fail('Você destruiu o veículo alvo');
      if (!t.surrendered) {
        m.objective = t.blockT > 0.2
          ? `Mantenha o bloqueio... ${Math.max(0, 2.5 - t.blockT).toFixed(1)} s`
          : `Intercepte o carro amarelo e feche a frente dele (alvo: ${Math.round(t.v.health)}%)`;
        if (!P.vehicle && !m.d.hint) { m.d.hint = true; g.hud.toast('Dica: use um carro para bloquear a passagem'); }
      } else m.objective = 'O alvo parou! Saia do carro e pegue o item (E)';
    },
    interact(m) {
      const t = m.d.target, P = m.g.player;
      if (t.surrendered && !P.vehicle && Math.hypot(P.pos.x - t.v.pos.x, P.pos.z - t.v.pos.z) < 3.8) {
        m.g.hud.call('Número desconhecido', 'Item recuperado. Você é dos nossos, André.');
        m.complete();
        return true;
      }
      return false;
    },
    prompt(m) {
      const t = m.d.target, P = m.g.player;
      return t.surrendered && !P.vehicle && Math.hypot(P.pos.x - t.v.pos.x, P.pos.z - t.v.pos.z) < 3.8 ? '[E] Pegar o item' : '';
    },
    cleanup(m) { m.g.traffic.removeTarget(); },
  },
];

export class MissionManager {
  constructor(game) {
    this.g = game;
    this.i = 0;
    this.d = {};
    this.timer = null;
    this.marker = null;
    this.objective = '';
    this.pending = null;
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 80, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd400, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.beacon.visible = false;
    game.scene.add(this.beacon);
    this.start(0);
  }
  get title() { return this.i < MISSIONS.length ? `Missão ${this.i + 1}/3 — ${MISSIONS[this.i].title}` : 'Missões concluídas'; }
  get current() { return MISSIONS[this.i]; }

  start(i) {
    this.i = i;
    this.d = {};
    this.timer = null;
    this.failed = false;
    this.marker = null;
    if (i >= MISSIONS.length) { this.objective = 'Você completou as 3 missões! Explore a cidade.'; this.beacon.visible = false; return; }
    this.g.hud.toast(this.title, '#ffd400');
    MISSIONS[i].start(this);
  }
  setMarker(x, z, color) { this.marker = { x, z, color }; }
  complete() {
    this.g.hud.toast('MISSÃO CONCLUÍDA', '#7dff7d');
    this.current.cleanup(this);
    this.pending = { t: 3.5, next: this.i + 1 };
    this.marker = null;
    this.timer = null;
  }
  fail(reason) {
    if (this.pending || this.i >= MISSIONS.length) return;
    this.failed = true;
    this.g.hud.toast(`MISSÃO FALHOU: ${reason}`, '#ff5050');
    this.current.cleanup(this);
    this.pending = { t: 3.5, next: this.i };
    this.marker = null;
    this.timer = null;
  }
  interact() { return !this.pending && this.current?.interact ? this.current.interact(this) : false; }
  prompt() { return !this.pending && this.current?.prompt ? this.current.prompt(this) : ''; }

  update(dt) {
    if (this.pending) {
      if ((this.pending.t -= dt) <= 0) { const n = this.pending.next; this.pending = null; this.start(n); }
    } else if (this.current) {
      this.current.update(this, dt);
      if (this.timer !== null && !this.pending && (this.timer -= dt) <= 0) this.fail('Tempo esgotado');
    }
    this.beacon.visible = !!this.marker;
    if (this.marker) {
      this.beacon.position.set(this.marker.x, 40, this.marker.z);
      this.beacon.material.color.set(this.marker.color);
    }
  }
}
