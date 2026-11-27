import { makeHuman, animateHuman, randomLook, setHumanShadow } from '../entities/Human.js';
import { clamp, lerpAngle } from '../core/math.js';
import DIALOGS from './dialogs.json';

/**
 * IA de pedestres 100% local e determinística (zero tokens / zero APIs):
 *  - FSM com estados ROTINA, CURIOSO, MEDO, FUGA, CAIDO (+ PARADO para NPCs de missão)
 *  - Utility AI: a cada 0,25 s cada NPC pontua as necessidades e troca para o estado de maior utilidade
 *  - Navegação por A* no grafo real de calçadas/footways do OpenStreetMap
 *  - Falas por árvore de decisão em JSON (hora do dia, nível de procurado, veículo do jogador)
 *  - Object pooling: NPCs longe do jogador são reciclados fora do campo de visão
 */
export const S = { ROTINA: 'ROTINA', CURIOSO: 'CURIOSO', MEDO: 'MEDO', FUGA: 'FUGA', CAIDO: 'CAIDO', PARADO: 'PARADO' };
const SPEED = { ROTINA: 1.3, CURIOSO: 0, MEDO: 2.6, FUGA: 4.8, CAIDO: 0, PARADO: 0 };
const EVENT_FEAR = { crash: [35, 0.9], hit: [30, 1.0], horn: [20, 0.55], carjack: [25, 0.85], siren: [25, 0.45] };
const RECYCLE_DIST = 170;

function test(expr, ctx) {
  const m = /^(\w+)\s*(>=|<=|==|>|<)?\s*(\S+)?$/.exec(expr.trim());
  if (!m) return false;
  const v = ctx[m[1]];
  if (!m[2]) return !!v;
  const r = isNaN(+m[3]) ? m[3] : +m[3];
  return { '>=': v >= r, '<=': v <= r, '==': v == r, '>': v > r, '<': v < r }[m[2]];
}

// Percorre a árvore {test, yes, no} até uma folha {say: [...]}; escolhe a fala de forma determinística.
export function pickLine(node, ctx, seed) {
  while (node && !node.say) node = test(node.test, ctx) ? node.yes : node.no;
  return node ? node.say[Math.abs(seed) % node.say.length] : null;
}

class Pedestrian {
  constructor(id, scene) {
    this.id = id;
    this.look = randomLook(id);
    this.mesh = makeHuman(this.look); // só o esqueleto: quem desenha é o CrowdRenderer
    this.state = S.ROTINA;
    this.path = [];
    this.seg = 0;
    this.t = 0;
    this.side = id % 2 ? 1 : -1;
    this.fear = 0;
    this.knock = 0;
    this.think = (id % 8) * 0.03; // escalona o "pensar" entre quadros
    this.phase = id;
    this.bubble = null;
    this.bubbleT = 0;
    this.talkCD = 0;
    this.curiousT = 0;
    this.curiousCD = 0;
    this.threat = { x: 0, z: 0 };
    this.spawned = false;
    this.fixed = false;
  }
  get pos() { return this.mesh.position; }
}

export class NPCController {
  constructor(scene, graph, count) {
    this.scene = scene;
    this.g = graph;
    this.peds = Array.from({ length: count }, (_, i) => new Pedestrian(i, scene));
    this.statics = [];
    this.nextId = count;
    this.active = count;
  }

  // Quantos pedestres ficam ativos (nível de gráfico). Os demais ficam escondidos no pool.
  setActive(n, shadows) {
    this.active = Math.min(n, this.peds.length);
    this.peds.forEach((p, i) => {
      setHumanShadow(p.mesh, shadows);
      if (i >= this.active) { p.mesh.visible = false; p.spawned = false; }
    });
  }

  // ---------- pool / spawn ----------
  _spawn(p, ctx) {
    const n = this.g.randomInRing(ctx.px, ctx.pz, 35, 140, (node) => ctx.visible(node.x, node.z));
    p.state = S.ROTINA;
    p.fear = p.knock = 0;
    p.mesh.rotation.set(0, 0, 0);
    p.bubble = null;
    this._routeFrom(p, n.id);
    this._place(p, true);
    p.spawned = true;
  }

  _routeFrom(p, startId) {
    const s = this.g.get(startId);
    const dest = this.g.randomInRing(s.x, s.z, 60, 220);
    p.path = this.g.astar(startId, dest.id, 2500) || [startId, s.edges[0]?.to].filter((x) => x != null);
    p.seg = 0;
    p.t = 0;
  }

  // Foge: escolhe o vizinho que mais afasta da ameaça (replanejado a cada nó).
  _routeAway(p) {
    const a = p.path[p.seg], b = p.path[p.seg + 1];
    let cur = a;
    if (b != null) {
      const na = this.g.get(a), nb = this.g.get(b);
      const da = Math.hypot(na.x - p.threat.x, na.z - p.threat.z), db = Math.hypot(nb.x - p.threat.x, nb.z - p.threat.z);
      if (db >= da) { p.path = [a, b]; p.seg = 0; return; }
      const len = this.g.edge(a, b)?.len || 0;
      p.path = [b, a]; p.seg = 0; p.t = Math.max(0, len - p.t); return;
    }
    const n = this.g.get(cur);
    let best = n.edges[0]?.to, bd = -1;
    for (const e of n.edges) {
      const m = this.g.get(e.to), d = Math.hypot(m.x - p.threat.x, m.z - p.threat.z);
      if (d > bd) { bd = d; best = e.to; }
    }
    p.path = best != null ? [cur, best] : [cur];
    p.seg = 0;
    p.t = 0;
  }

  _place(p, snap) {
    const pt = this.g.pointOn(p.path[p.seg], p.path[p.seg + 1], p.t, p.side);
    if (snap) p.pos.set(pt.x, 0, pt.z);
    else { p.pos.x += (pt.x - p.pos.x) * 0.35; p.pos.z += (pt.z - p.pos.z) * 0.35; }
    return pt;
  }

  // ---------- Utility AI ----------
  _evaluate(p, ctx) {
    if (p.state === S.CAIDO || p.state === S.PARADO) return;
    const d = Math.hypot(p.pos.x - ctx.px, p.pos.z - ctx.pz);
    // Medo: carro do jogador em alta velocidade perto + eventos (batidas, atropelos, buzina, sirene)
    let fear = ctx.inVehicle ? clamp(ctx.speed / 14, 0, 1) * clamp(1 - d / 30, 0, 1) : 0;
    for (const ev of ctx.events) {
      const [r, w] = EVENT_FEAR[ev.type] || [0, 0];
      const de = Math.hypot(p.pos.x - ev.x, p.pos.z - ev.z);
      if (de < r && ctx.time - ev.t < 0.6) { const f = w * (1 - de / (r * 1.5)); if (f > fear) { fear = f; p.threat = { x: ev.x, z: ev.z }; } }
    }
    if (fear > 0 && ctx.inVehicle && fear >= p.fear) p.threat = { x: ctx.px, z: ctx.pz };
    if (ctx.wanted > 0 && d < 15) fear = Math.max(fear, 0.12 * ctx.wanted);
    p.fear = Math.max(fear, p.fear * 0.92); // memória do susto
    const curiosity = p.curiousCD > 0 ? 0
      : !ctx.inVehicle && d < 6 && ctx.speed < 2.5 ? 0.65
      : ctx.inVehicle && d < 9 && ctx.speed < 1 ? 0.5 : 0;
    const scores = {
      [S.ROTINA]: 0.3,
      [S.CURIOSO]: curiosity,
      [S.MEDO]: p.fear > 0.3 ? p.fear * 0.9 : 0,
      [S.FUGA]: p.fear > 0.7 ? p.fear + 0.1 : 0,
    };
    scores[p.state] = (scores[p.state] || 0) + 0.1; // histerese: evita trocar de estado toda hora
    let best = p.state, bs = -1;
    for (const [s, v] of Object.entries(scores)) if (v > bs) { bs = v; best = s; }
    if (best !== p.state) this._enter(p, best, ctx);
  }

  _enter(p, state, ctx) {
    const prev = p.state;
    p.state = state;
    if (state === S.CURIOSO) p.curiousT = 4;
    if (prev === S.CURIOSO) p.curiousCD = 12;
    if (state === S.MEDO || state === S.FUGA) this._routeAway(p);
    if (state === S.ROTINA && (prev === S.MEDO || prev === S.FUGA)) this._routeFrom(p, p.path[p.seg]);
    if (DIALOGS[state] && p.talkCD <= 0) this.say(p, pickLine(DIALOGS[state], ctx, p.id + Math.floor(ctx.time)));
  }

  say(p, text, secs = 3.5) {
    if (!text) return;
    p.bubble = text;
    p.bubbleT = secs;
    p.talkCD = 5;
  }

  // ---------- atualização ----------
  update(dt, ctx) {
    const dctx = { ...ctx, night: ctx.night ? 1 : 0 };
    let budget = 2; // no máximo 2 pedestres reaparecem por quadro (sem rajada de rotas num quadro só)
    for (let i = 0; i < this.active; i++) {
      const p = this.peds[i];
      if (!p.spawned) { if (budget-- > 0) this._spawn(p, ctx); else p.mesh.visible = false; continue; } // visibilidade volta abaixo (d < 110)
      const d = Math.hypot(p.pos.x - ctx.px, p.pos.z - ctx.pz);
      p.mesh.visible = d < 110; // longe demais: nem desenha
      if (d > RECYCLE_DIST || (d > 90 && p.state === S.ROTINA && !ctx.visible(p.pos.x, p.pos.z) && Math.random() < 0.002)) {
        if (budget-- > 0) this._spawn(p, ctx); else { p.spawned = false; p.mesh.visible = false; }
        continue;
      }
      p.think -= dt;
      if (p.think <= 0) { p.think = 0.25; this._evaluate(p, dctx); }
      this._act(p, dt, ctx, dctx);
    }
    for (const p of this.statics) this._timers(p, dt);
  }

  // Envia os pedestres visíveis para o CrowdRenderer (desenho em lote).
  draw(crowd, skip = null) {
    for (let i = 0; i < this.active; i++) { const p = this.peds[i]; if (p.spawned && p.mesh.visible && !skip?.has(p)) crowd.add(p.mesh); }
    for (const p of this.statics) { animateHuman(p.mesh, 0, 0); crowd.add(p.mesh); }
  }

  _timers(p, dt) {
    p.talkCD -= dt;
    p.curiousCD -= dt;
    if (p.bubbleT > 0 && (p.bubbleT -= dt) <= 0) p.bubble = null;
  }

  _act(p, dt, ctx, dctx) {
    this._timers(p, dt);
    p.curSpeed = 0;
    if (p.state === S.CAIDO) {
      p.knock -= dt;
      if (p.knock <= 0) { p.mesh.rotation.set(0, p.mesh.rotation.y, 0); p.pos.y = 0; p.fear = 1; this._enter(p, S.FUGA, dctx); }
      return;
    }
    if (p.state === S.CURIOSO) {
      p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, Math.atan2(ctx.px - p.pos.x, ctx.pz - p.pos.z), 6 * dt);
      animateHuman(p.mesh, 0, 0);
      if ((p.curiousT -= dt) <= 0) this._enter(p, S.ROTINA, dctx);
      return;
    }
    const sp = SPEED[p.state] * (p.look?.slow && p.state === S.ROTINA ? 0.6 : 1); // idosos andam mais devagar
    p.curSpeed = sp;
    p.t += sp * dt;
    let pt = this.g.pointOn(p.path[p.seg], p.path[p.seg + 1], p.t, p.side);
    while (pt.len && p.t >= pt.len) {
      p.t -= pt.len;
      p.seg++;
      if (p.seg >= p.path.length - 1) {
        if (p.state === S.ROTINA) this._routeFrom(p, p.path[p.path.length - 1]);
        else this._routeAway(p);
      }
      pt = this.g.pointOn(p.path[p.seg], p.path[p.seg + 1], p.t, p.side);
    }
    const k = Math.min(1, 8 * dt);
    p.pos.x += (pt.x - p.pos.x) * k;
    p.pos.z += (pt.z - p.pos.z) * k;
    p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, pt.h, 8 * dt);
    p.phase += dt * (sp > 3 ? 9 : sp * 4.2);
    animateHuman(p.mesh, p.phase, sp > 3 ? 1 : sp > 0 ? 0.5 : 0);
  }

  // Atropelamento: caixa orientada do carro contra cada pedestre.
  hitTest(v) {
    const hits = [];
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const p of [...this.peds.slice(0, this.active), ...this.statics]) {
      if (p.state === S.CAIDO || !p.spawned && !p.fixed) continue;
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      const along = dx * fx + dz * fz, side = -dx * fz + dz * fx;
      if (Math.abs(along) < 2.5 && Math.abs(side) < 1.3) {
        p.state = S.CAIDO;
        p.knock = 6;
        p.mesh.rotation.x = -Math.PI / 2;
        p.pos.y = 0.2;
        p.pos.x += fx * 1.5;
        p.pos.z += fz * 1.5;
        p.bubble = pickLine(DIALOGS.CAIDO, {}, p.id);
        p.bubbleT = 3;
        hits.push(p);
      }
    }
    return hits;
  }

  // NPC fixo para missões (não entra no pool).
  spawnStatic(x, z, look = { shirt: 0x222222, pants: 0x161616, skin: 0x8d5a3b, hair: 0x0d0d0d, shoes: 0x111111, hairStyle: 'none', longSleeve: true, shorts: false, h: 1.04, w: 1.15 }) {
    const p = new Pedestrian(this.nextId++, this.scene);
    p.look = look;
    p.mesh = makeHuman(look);
    p.state = S.PARADO;
    p.fixed = true;
    p.pos.set(x, 0, z);
    this.statics.push(p);
    return p;
  }

  removeStatic(p) {
    if (!p) return;
    this.statics = this.statics.filter((s) => s !== p);
  }

  bubbles() {
    return [...this.peds.slice(0, this.active), ...this.statics].filter((p) => p.bubble).map((p) => ({ x: p.pos.x, y: 2.2, z: p.pos.z, text: p.bubble }));
  }

  countByState() {
    const c = {};
    for (const p of this.peds.slice(0, this.active)) c[p.state] = (c[p.state] || 0) + 1;
    return c;
  }
}

