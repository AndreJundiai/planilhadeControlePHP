import * as THREE from 'three';
import { Vehicle } from '../player/Vehicle.js';

/**
 * Gerenciador de missões. Cada missão tem start/update/cleanup (+ interact opcional).
 * Os pontos vêm do grafo real do OSM: distâncias medidas pelas ruas, não em linha reta.
 */
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const brl = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');

// Valores de jogo das missões (dados, não código espalhado): prazos, distâncias e pagamentos.
export const MISSION_TUNING = {
  reward: [40, 60, 120, 150, 180, 200, 250, 500], // R$ pago ao concluir cada missão
  race: { length: 1300, checkpoints: 5, speed: 13, extra: 25 }, // corrida: m, pontos, m/s esperados, s de folga
  blitz: { stars: 2, time: 150 },                               // fuga: estrelas e prazo para despistar
  boss: { carDist: 260, garageDist: 1000, maxHits: 3 },         // carro do chefe: distâncias e batidas fortes toleradas
  finale: { loop: 600, speedK: 1.25 },                          // final: tamanho da volta e velocidade do chefe
};
const MISSIONS = [
  {
    title: 'Compras no Dom',
    start(m) {
      const g = m.g;
      m.d.stage = 0;
      g.hud.call('Mãe', `André, passa no ${g.dom.name} aqui na Rua do Retiro e compra pão, leite e café pra casa, por favor!`);
    },
    update(m) {
      const g = m.g, P = g.player, d = g.dom;
      if (m.d.stage === 0) {
        m.setMarker(d.x, d.z, '#ffd400');
        m.objective = P.vehicle ? `Saia do carro e entre no ${d.name}` : `Entre no ${d.name}, pegue as compras e pague no caixa (${Math.round(dist(P.pos, d))} m)`;
        return;
      }
      const car = g.myCar;
      m.setMarker(car.pos.x, car.pos.z, '#ff5050');
      m.objective = 'Leve as compras até o seu carro vermelho';
      if (P.vehicle === car || (!P.vehicle && dist(P.pos, car.pos) < 3.5)) {
        P.hasGroceries = false;
        g.hud.call('Mãe', 'Obrigada, filho! Agora vai lá que seu amigo está te ligando...');
        m.complete();
      }
    },
    interact(m) {
      const g = m.g, P = g.player;
      if (m.d.stage !== 0 || P.vehicle || dist(P.pos, g.dom) > 3.5) return false;
      const items = [['pão francês', 6.5], ['leite', 5.9], ['café', 17.9]];
      const total = items.reduce((a, i) => a + i[1], 0);
      P.money -= total;
      P.hasGroceries = true;
      m.d.stage = 1;
      g.sound?.cash();
      g.hud.toast(`Comprou ${items.map((i) => i[0]).join(', ')} — ${brl(total)}`, '#7dff7d');
      return true;
    },
    prompt(m) {
      const g = m.g, P = m.g.player;
      return m.d.stage === 0 && !P.vehicle && dist(P.pos, g.dom) < 3.5 ? `[E] Pagar as compras no caixa do ${g.dom.name}` : '';
    },
    cleanup() {},
  },
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
      const car = new Vehicle(0x2a7bd4, false, 'hatch');
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
  {
    title: 'Corrida na Avenida',
    start(m) {
      const g = m.g, P = g.player.pos, G = g.carGraph, T = MISSION_TUNING.race;
      const s = G.nearest(P.x, P.z), end = G.nodeAtDistance(s.id, T.length);
      const path = (G.astar(s.id, end.id) || [s.id, end.id]).map((id) => G.nodes.get(id)).filter(Boolean);
      // pontos de controle espalhados ao longo do caminho pelas ruas
      m.d.cps = Array.from({ length: T.checkpoints }, (_, k) => path[Math.min(path.length - 1, Math.round(((k + 1) / T.checkpoints) * (path.length - 1)))]);
      m.d.k = 0;
      m.d.started = false;
      m.d.total = G.pathLength ? G.pathLength(path.map((n) => n.id)) : T.length;
      g.hud.call('Primo do Zé', `Bora ver se você é piloto mesmo, André. ${T.checkpoints} pontos de controle pelas avenidas, contra o relógio. Pega um carro e passa pelo primeiro!`);
    },
    update(m) {
      const g = m.g, P = g.player, T = MISSION_TUNING.race, cp = m.d.cps[m.d.k];
      m.setMarker(cp.x, cp.z, '#ff7a00');
      if (!P.vehicle) { m.objective = 'Entre num carro para correr'; return; }
      if (!m.d.started) { m.d.started = true; m.timer = Math.round(m.d.total / T.speed + T.extra); g.hud.toast('VALENDO!', '#ff7a00'); }
      const d = dist(P.pos, cp);
      m.objective = `Ponto de controle ${m.d.k + 1}/${m.d.cps.length} (${Math.round(d)} m)`;
      if (d < 12) {
        g.sound?.cash();
        if (++m.d.k >= m.d.cps.length) { g.hud.call('Primo do Zé', 'Que isso! Tá aprovado, piloto.'); m.complete(); }
      }
    },
    cleanup() {},
  },
  {
    title: 'Fuga da Blitz',
    start(m) {
      m.d.on = false;
      m.g.hud.call('Número desconhecido', 'André, a polícia montou uma blitz e anotou a placa do carro que você usou. Pega um carro e DESPISTA as viaturas!');
    },
    update(m) {
      const g = m.g, P = g.player, T = MISSION_TUNING.blitz;
      if (!m.d.on) {
        m.objective = 'Entre num carro';
        if (P.vehicle) { m.d.on = true; g.wanted.set(T.stars, 'Blitz! A polícia está atrás de você'); m.timer = T.time; }
        return;
      }
      m.marker = null;
      m.objective = g.wanted.level > 0 ? `Despiste a polícia (${'★'.repeat(g.wanted.level)}) — fique longe das viaturas` : 'Livre!';
      if (g.wanted.level === 0) { g.hud.call('Número desconhecido', 'Sumiu do radar. Esse é dos bons.'); m.complete(); }
    },
    cleanup() {},
  },
  {
    title: 'O Carro do Chefe',
    start(m) {
      const g = m.g, p = g.player.pos, G = g.carGraph, T = MISSION_TUNING.boss;
      const near = G.nodeAtDistance(G.nearest(p.x, p.z).id, T.carDist);
      const car = new Vehicle(0x111418, false, 'suv');
      g.placeOnRoad(car, near);
      g.scene.add(car.mesh);
      g.parked.push(car);
      m.d.car = car;
      m.d.garage = G.nodeAtDistance(near.id, T.garageDist);
      m.d.hits = 0;
      m.d.lastHit = -1;
      g.hud.call('O Chefe', 'Meu SUV preto ficou estacionado ali perto. Traz ele pra garagem SEM UM ARRANHÃO. Três batidas fortes e você está fora.');
    },
    update(m) {
      const g = m.g, P = g.player, T = MISSION_TUNING.boss, car = m.d.car;
      if (P.vehicle !== car) {
        m.setMarker(car.pos.x, car.pos.z, '#9aa4ad');
        m.objective = 'Pegue o SUV preto do chefe (E)';
        return;
      }
      for (const e of g.events) if (e.type === 'crash' && e.t > m.d.lastHit + 0.8) { m.d.lastHit = e.t; m.d.hits++; g.hud.toast(`Batida! (${m.d.hits}/${T.maxHits})`, '#ff8080'); }
      if (m.d.hits >= T.maxHits) return m.fail('Você amassou o carro do chefe');
      const dest = m.d.garage, d = dist(P.pos, dest);
      m.setMarker(dest.x, dest.z, '#ffd400');
      m.objective = `Leve o SUV até a garagem (${Math.round(d)} m) — batidas ${m.d.hits}/${T.maxHits}`;
      if (d < 10 && Math.abs(car.speed) < 3) { g.hud.call('O Chefe', 'Inteirinho. Amanhã a gente conversa sobre o serviço grande.'); m.complete(); }
    },
    cleanup(m) { if (m.failed) { m.g.scene.remove(m.d.car.mesh); m.g.parked = m.g.parked.filter((v) => v !== m.d.car); } },
  },
  {
    title: 'Acerto de Contas (FINAL)',
    start(m) {
      const g = m.g, p = g.player.pos, G = g.carGraph, T = MISSION_TUNING.finale;
      const s = G.nearest(p.x, p.z);
      const A = G.nodeAtDistance(s.id, 250), B = G.nodeAtDistance(A.id, T.loop);
      const go = G.astar(A.id, B.id) || [A.id], back = G.astar(B.id, A.id) || [B.id];
      const loop = go.concat(back.slice(1));
      m.d.target = g.traffic.addTarget(loop.length > 2 ? loop : [A.id, A.edges[0].to, A.id], 0x111111, T.speedK);
      m.d.stage = 0;
      g.hud.call('Zé', 'André! O chefe passou a perna em todo mundo e está fugindo com o dinheiro da Festa da Uva num carro PRETO. Fecha ele! Depois some daqui e vai pra casa.');
    },
    update(m) {
      const g = m.g, P = g.player;
      if (m.d.stage === 1) {
        const h = g.home, d = dist(P.pos, h);
        m.setMarker(h.x, h.z, '#2ecc71');
        m.objective = g.wanted.level > 0 ? 'Despiste a polícia e volte para casa' : `Volte para casa (${Math.round(d)} m)`;
        if (d < 5 && g.wanted.level === 0) { m.complete(); g.ending?.show(); }
        return;
      }
      const t = m.d.target;
      m.setMarker(t.v.pos.x, t.v.pos.z, '#ff3030');
      if (t.v.health <= 0) return m.fail('O carro do chefe pegou fogo com o dinheiro dentro');
      m.objective = t.surrendered ? 'O chefe parou! Saia do carro e pegue o dinheiro (E)'
        : t.blockT > 0.2 ? `Segura o bloqueio... ${Math.max(0, 2.5 - t.blockT).toFixed(1)} s` : 'Persiga e feche o carro preto do chefe';
    },
    interact(m) {
      const t = m.d.target, P = m.g.player;
      if (m.d.stage === 0 && t.surrendered && !P.vehicle && dist(P.pos, t.v.pos) < 3.8) {
        m.d.stage = 1;
        m.g.traffic.removeTarget();
        m.g.wanted.set(1, 'Alguém chamou a polícia!');
        m.g.hud.call('Zé', 'Pegou! Agora vai pra casa, lava o rosto e esquece esse povo. Valeu, André.');
        return true;
      }
      return false;
    },
    prompt(m) {
      const t = m.d.target, P = m.g.player;
      return m.d.stage === 0 && t?.surrendered && !P.vehicle && dist(P.pos, t.v.pos) < 3.8 ? '[E] Pegar o dinheiro' : '';
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
  get title() { return this.i < MISSIONS.length ? `Missão ${this.i + 1}/${MISSIONS.length} — ${MISSIONS[this.i].title}` : 'Missões concluídas'; }
  get current() { return MISSIONS[this.i]; }
  get count() { return MISSIONS.length; }

  start(i) {
    this.i = i;
    this.d = {};
    this.timer = null;
    this.failed = false;
    this.marker = null;
    if (i >= MISSIONS.length) { this.objective = 'FIM da história — Jundiaí é sua. Explore à vontade!'; this.beacon.visible = false; return; }
    this.g.hud.toast(this.title, '#ffd400');
    MISSIONS[i].start(this);
  }
  setMarker(x, z, color) { this.marker = { x, z, color }; }
  complete() {
    const reward = MISSION_TUNING.reward[this.i] || 0;
    this.g.player.money += reward;
    this.g.hud.toast(`MISSÃO CONCLUÍDA  +${brl(reward)}`, '#7dff7d');
    this.g.sound?.missionDone();
    setTimeout(() => this.g.save?.(), 3600); // salva já com a próxima missão
    this.current.cleanup(this);
    this.pending = { t: 3.5, next: this.i + 1 };
    this.marker = null;
    this.timer = null;
  }
  fail(reason) {
    if (this.pending || this.i >= MISSIONS.length) return;
    this.failed = true;
    this.g.hud.toast(`MISSÃO FALHOU: ${reason}`, '#ff5050');
    this.g.sound?.missionFail();
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
    const P = this.g.player?.pos;
    this.beacon.visible = !!this.marker && (!P || Math.hypot(P.x - this.marker.x, P.z - this.marker.z) > 28);
    if (this.marker) {
      this.beacon.position.set(this.marker.x, 40, this.marker.z);
      this.beacon.material.color.set(this.marker.color);
    }
  }
}
