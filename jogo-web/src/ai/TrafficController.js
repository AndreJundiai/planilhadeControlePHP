import { Vehicle } from '../player/Vehicle.js';
import { clamp, lerpAngle, angleDiff } from '../core/math.js';
import { signalState } from '../map/StreetFurniture.js';
import { carVsCar, personVsCar } from '../systems/Collisions.js';

// proporção dos modelos no trânsito de Jundiaí: muito hatch e sedã, alguns SUVs, picapes, furgões, táxis e esportivos
const TRAFFIC_MIX = ['hatch', 'hatch', 'hatch', 'sedan', 'sedan', 'suv', 'suv', 'pickup', 'van', 'taxi', 'coupe'];
const COLORS = [0xd9d9d9, 0x1f1f1f, 0x8a8f96, 0x9b1c1c, 0x1d3f8f, 0xe0e0e0, 0x2d5a3d, 0x6b4b2a, 0xc9b26b];

/**
 * Trânsito e polícia no grafo viário real (A*), com object pooling.
 *  - traffic: rodam rotas aleatórias, mão direita, freiam para obstáculos à frente
 *  - police: patrulham; com nível de procurado > 0 replanejam A* até o jogador e perseguem
 *  - target: carro da missão 3, roda em circuito fixo e "se rende" quando bloqueado
 */
export class TrafficController {
  constructor(scene, graph, { count, police }) {
    this.scene = scene;
    this.g = graph;
    this.cars = [];
    this.target = null;
    for (let i = 0; i < count; i++) this.cars.push(this._make('traffic'));
    for (let i = 0; i < police; i++) { const c = this._make('police'); c.active = false; c.v.mesh.visible = false; this.cars.push(c); }
  }

  // Quantos carros comuns rodam (nível de gráfico). Os demais ficam escondidos no pool.
  setActive(n) {
    let i = 0;
    for (const c of this.cars) {
      if (c.kind !== 'traffic') continue;
      const on = i++ < n;
      if (!on && c.active) { c.active = false; c.spawned = false; c.v.mesh.visible = false; }
      if (on && !c.active) { c.active = true; c.spawned = false; c.v.mesh.visible = true; }
    }
  }

  _make(kind, color) {
    const type = kind === 'traffic' ? TRAFFIC_MIX[Math.floor(Math.random() * TRAFFIC_MIX.length)] : 'sedan';
    const v = new Vehicle(color ?? (kind === 'police' ? 0xf4f4f4 : COLORS[Math.floor(Math.random() * COLORS.length)]), kind === 'police', type);
    this.scene.add(v.mesh);
    return { v, kind, path: [], seg: 0, t: 0, active: true, spawned: false, replan: 0, stuck: 0, ghost: 0, hitCD: 0, chasing: false, loop: false, blockT: 0, surrendered: false };
  }

  _spawn(c, ctx, rmin = 70, rmax = 200) {
    const n = this.g.randomInRing(ctx.px, ctx.pz, rmin, rmax, (node) => ctx.visible(node.x, node.z));
    this._routeFrom(c, n.id);
    const p = this._pose(c);
    c.v.place(p.x, p.z, p.h);
    c.v.speed = Math.min(6, p.speed);
    c.spawned = true;
  }

  _routeFrom(c, startId, goalId) {
    const s = this.g.get(startId);
    const goal = goalId ?? this.g.randomInRing(s.x, s.z, 150, 450).id;
    c.path = this.g.astar(startId, goal, 2500) || [startId, s.edges[0]?.to].filter((x) => x != null);
    c.seg = 0;
    c.t = 0;
  }

  _pose(c) {
    const pt = this.g.pointOn(c.path[c.seg], c.path[c.seg + 1], c.t, 1);
    return { ...pt, h: pt.len ? pt.h : c.v.heading, speed: pt.e?.speed || 9 };
  }

  update(dt, ctx) {
    let need = ctx.wanted;
    for (const c of this.cars) {
      if (c.kind !== 'police') continue;
      if (need > 0) {
        need--;
        if (!c.active) { c.active = true; c.v.mesh.visible = true; this._spawn(c, ctx, 110, 200); }
        c.chasing = true;
      } else c.chasing = false;
    }
    let budget = 1; // no máximo 1 carro do trânsito reaparece por quadro
    for (const c of this.cars) {
      if (!c.active) continue;
      if (!c.spawned) { // carro que esperou a vez: reaparece e volta a ser desenhado
        if (c.kind !== 'traffic' || budget-- > 0) { this._spawn(c, ctx); c.v.mesh.visible = true; } else { c.v.mesh.visible = false; continue; }
      }
      const v = c.v, d = Math.hypot(v.pos.x - ctx.px, v.pos.z - ctx.pz);
      c.hitCD -= dt;
      if (c !== this.target) {
        if (c.kind === 'police' && c.chasing) { if (d > 420) this._spawn(c, ctx, 120, 200); }
        else if (d > 230) {
          if (c.kind === 'police') { c.active = false; c.spawned = false; v.mesh.visible = false; continue; }
          if (budget-- > 0) { this._spawn(c, ctx); v.mesh.visible = true; } else { c.spawned = false; v.mesh.visible = false; }
          continue;
        }
      }
      if (c.kind === 'police' && c.chasing) this._chase(c, dt, ctx, d);
      else this._follow(c, dt, ctx);
      v.siren(c.kind === 'police' && c.chasing, ctx.time);
    }
    this._collide(ctx);
  }

  _follow(c, dt, ctx, cruise) {
    const v = c.v;
    let p = this._pose(c);
    let target = (cruise ?? p.speed) * (c.speedK || 1);
    // reduz antes de curvas fechadas
    const nb = this.g.get(c.path[c.seg + 2]);
    if (nb && p.len - c.t < 14) {
      const b = this.g.get(c.path[c.seg + 1]);
      if (Math.abs(angleDiff(p.h, Math.atan2(nb.x - b.x, nb.z - b.z))) > 0.6) target = Math.min(target, 5.5);
    }
    // obstáculo à frente (outros carros, jogador, carros estacionados)
    const ob = c.ghost > 0 ? 99 : this._ahead(c, ctx);
    if (ob < 4.5) target = 0;
    else if (ob < 12) target = Math.min(target, (ob - 4.5) * 1.6);
    if (c === this.target) {
      this._targetBlock(c, dt, ctx);
      if (c.surrendered) target = 0;
    }
    c.ghost -= dt;
    c.stuck = target < 0.5 && c !== this.target ? c.stuck + dt : 0;
    if (c.stuck > 6) { c.ghost = 2; c.stuck = 0; } // destrava cruzamentos
    v.speed += clamp(target - v.speed, -10 * dt, 4 * dt);
    c.t += Math.max(0, v.speed) * dt;
    while (p.len && c.t >= p.len) {
      c.t -= p.len;
      c.seg++;
      if (c.seg >= c.path.length - 1) {
        if (c.loop) c.seg = 0;
        else this._routeFrom(c, c.path[c.path.length - 1]);
      }
      p = this._pose(c);
    }
    p = this._pose(c);
    const k = Math.min(1, 10 * dt);
    v.pos.x += (p.x - v.pos.x) * k;
    v.pos.z += (p.z - v.pos.z) * k;
    v.heading = lerpAngle(v.heading, p.h, 8 * dt);
    v.mesh.rotation.y = v.heading;
    v.vx = Math.sin(v.heading) * v.speed;
    v.vz = Math.cos(v.heading) * v.speed;
  }

  _chase(c, dt, ctx, d) {
    const v = c.v;
    c.replan -= dt;
    if (d < 35 || c.path.length < 2) {
      // perseguição direta nos últimos metros
      v.heading = lerpAngle(v.heading, Math.atan2(ctx.px - v.pos.x, ctx.pz - v.pos.z), 3 * dt);
      const want = d < 6 ? 0 : Math.min(20, d * 0.9);
      v.speed += clamp(want - v.speed, -14 * dt, 6 * dt);
      v.pos.x += Math.sin(v.heading) * v.speed * dt;
      v.pos.z += Math.cos(v.heading) * v.speed * dt;
      v.mesh.rotation.y = v.heading;
      v.vx = Math.sin(v.heading) * v.speed;
      v.vz = Math.cos(v.heading) * v.speed;
      c.replan = 0;
      return;
    }
    if (c.replan <= 0) {
      c.replan = 1.5;
      const s = this.g.nearest(v.pos.x, v.pos.z), g = this.g.nearest(ctx.px, ctx.pz);
      c.path = this.g.astar(s.id, g.id, 4000) || [s.id]; // polícia perseguindo: um pouco mais de busca
      c.seg = 0;
      c.t = 0;
    }
    c.ghost = 1; // viatura não espera ninguém
    this._follow(c, dt, ctx, 17);
  }

  _ahead(c, ctx) {
    const v = c.v, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let best = 99;
    const test = (x, z) => {
      const dx = x - v.pos.x, dz = z - v.pos.z, along = dx * fx + dz * fz;
      if (along <= 0 || along > 14) return;
      if (Math.abs(-dx * fz + dz * fx) < 2.2) best = Math.min(best, along);
    };
    for (const o of this.cars) if (o !== c && o.active && o.spawned) test(o.v.pos.x, o.v.pos.z);
    test(ctx.px, ctx.pz);
    for (const p of ctx.parked) test(p.pos.x, p.pos.z);
    // semáforo vermelho/amarelo virado para este carro: para antes da faixa
    for (const L of ctx.lights || []) {
      const dx = L.x - v.pos.x, dz = L.z - v.pos.z, along = dx * fx + dz * fz;
      if (along <= 0 || along > 26) continue;
      if (Math.sin(L.h) * fx + Math.cos(L.h) * fz > -0.7) continue; // não é para este sentido
      if (Math.abs(-dx * fz + dz * fx) > 9) continue;
      const s = signalState(L.phase, ctx.time);
      if (s === 0 || (s === 1 && along > 9)) best = Math.min(best, along); // para ~4,5 m antes, atrás da faixa
    }
    return best;
  }

  // Missão 3: o alvo só para se o carro do jogador fechar a frente dele, devagar, por 2,5 s.
  _targetBlock(c, dt, ctx) {
    const pv = ctx.playerVeh, v = c.v;
    let blocked = false;
    if (pv && Math.abs(pv.speed) < 3) {
      const dx = pv.pos.x - v.pos.x, dz = pv.pos.z - v.pos.z, fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const along = dx * fx + dz * fz;
      blocked = along > 0 && along < 8 && Math.abs(-dx * fz + dz * fx) < 2.8;
    }
    c.blockT = blocked ? c.blockT + dt : Math.max(0, c.blockT - dt * 0.5);
    if (c.blockT > 2.5) c.surrendered = true;
  }

  _collide(ctx) {
    const pv = ctx.playerVeh;
    for (const c of this.cars) {
      if (!c.active || !c.spawned) continue;
      const v = c.v;
      if (pv) {
        if (Math.abs(pv.pos.x - v.pos.x) > 7 || Math.abs(pv.pos.z - v.pos.z) > 7) continue;
        const hit = carVsCar(pv, v); // forma real do carro (cápsula), não um círculo de 3 m
        if (hit.d < 0) {
          const nx = hit.nx, nz = hit.nz;
          const rel = Math.abs((pv.vx - v.vx) * nx + (pv.vz - v.vz) * nz);
          ctx.pushPlayer(-nx * hit.d, -nz * hit.d);
          if (rel > 1.5 && c.hitCD <= 0) {
            c.hitCD = 0.8;
            pv.speed *= 0.35;
            v.speed *= 0.2;
            ctx.onCrash(c, rel);
          }
        }
      } else if (ctx.onFoot) {
        const d = personVsCar(ctx.px, ctx.pz, v).d;
        if (d < 0.15 && Math.abs(v.speed) > 3 && c.hitCD <= 0) { c.hitCD = 1.5; ctx.onRunOver(c, Math.abs(v.speed)); v.speed *= 0.3; }
      }
    }
  }

  // ---------- API usada pelo jogo / missões ----------
  nearestCar(x, z, r) {
    let best = null, bd = r;
    for (const c of this.cars) {
      if (!c.active || !c.spawned || c.kind !== 'traffic') continue;
      const d = Math.hypot(c.v.pos.x - x, c.v.pos.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  take(c) {
    this.cars = this.cars.filter((o) => o !== c);
    const fresh = this._make('traffic');
    fresh.spawned = false;
    this.cars.push(fresh);
    c.v.speed = 0;
    return c.v;
  }

  policeNear(x, z, r) {
    return this.cars.some((c) => c.kind === 'police' && c.active && c.spawned && Math.hypot(c.v.pos.x - x, c.v.pos.z - z) < r);
  }

  police() { return this.cars.filter((c) => c.kind === 'police'); }

  resetPolice() {
    for (const c of this.police()) { c.active = false; c.spawned = false; c.chasing = false; c.v.mesh.visible = false; c.v.siren(false, 0); }
  }

  addTarget(loop, color = 0xf5c400, speedK = 1) {
    this.removeTarget();
    const c = this._make('target', color);
    c.speedK = speedK; // o carro do chefe, no final, anda mais rápido
    c.path = loop;
    c.loop = true;
    c.spawned = true;
    c.v.health = 100;
    const p = this._pose(c);
    c.v.place(p.x, p.z, p.h);
    this.cars.push(c);
    this.target = c;
    return c;
  }

  removeTarget() {
    if (!this.target) return;
    this.scene.remove(this.target.v.mesh);
    this.cars = this.cars.filter((c) => c !== this.target);
    this.target = null;
  }
}
