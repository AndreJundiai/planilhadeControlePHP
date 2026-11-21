// Colisões leves (sem física) entre o jogador e o que não tem colisor no Rapier:
// carros do trânsito, viaturas, carros estacionados e pedestres.
// Carro = cápsula (segmento ao longo do carro, raio = meia largura); pessoa = círculo.
const HALF = 1.25, R_CAR = 0.95, R_PERSON = 0.35;

function segOf(v) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading), h = v.halfLen ?? HALF; // ônibus é mais comprido
  return [v.pos.x - fx * h, v.pos.z - fz * h, v.pos.x + fx * h, v.pos.z + fz * h];
}
function closestOnSeg(px, pz, s) {
  const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - s[0]) * dx + (pz - s[1]) * dz) / L2));
  return [s[0] + dx * t, s[1] + dz * t];
}

// Distância entre duas cápsulas de carro → { d (folga, <0 = encostado), nx, nz (de b para a) }
export function carVsCar(a, b) {
  const A = segOf(a), B = segOf(b);
  let best = null;
  // aproximação boa para segmentos curtos: testa as pontas de cada um contra o outro
  for (const [px, pz, S, sign] of [[A[0], A[1], B, 1], [A[2], A[3], B, 1], [B[0], B[1], A, -1], [B[2], B[3], A, -1], [a.pos.x, a.pos.z, B, 1], [b.pos.x, b.pos.z, A, -1]]) {
    const [qx, qz] = closestOnSeg(px, pz, S), d = Math.hypot(px - qx, pz - qz);
    if (!best || d < best.d) best = { d, nx: ((px - qx) / (d || 1)) * sign, nz: ((pz - qz) / (d || 1)) * sign };
  }
  best.d -= (a.radius ?? R_CAR) + (b.radius ?? R_CAR);
  return best;
}

export function personVsCar(px, pz, v) {
  const [qx, qz] = closestOnSeg(px, pz, segOf(v)), d = Math.hypot(px - qx, pz - qz);
  return { d: d - (v.radius ?? R_CAR) - R_PERSON, nx: (px - qx) / (d || 1), nz: (pz - qz) / (d || 1) };
}

// André a pé contra carros e pedestres: empurra para fora (nada de atravessar)
export function resolveOnFoot(g) {
  const P = g.player;
  if (P.vehicle) return;
  let x = P.pos.x, z = P.pos.z, moved = false;
  const cars = [...g.parked, ...g.extraCars(), ...g.traffic.cars.filter((c) => c.active && c.spawned).map((c) => c.v)];
  for (const v of cars) {
    if (Math.abs(v.pos.x - x) > 7 || Math.abs(v.pos.z - z) > 7) continue;
    const r = personVsCar(x, z, v);
    if (r.d < 0) { x -= r.nx * r.d; z -= r.nz * r.d; moved = true; }
  }
  for (let i = 0; i < g.npc.active; i++) {
    const q = g.npc.peds[i];
    if (!q.spawned || q.state === 'CAIDO') continue;
    const dx = x - q.pos.x, dz = z - q.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.01 && d < R_PERSON * 2) { const k = (R_PERSON * 2 - d) / d; x += dx * k * 0.6; z += dz * k * 0.6; q.pos.x -= dx * k * 0.4; q.pos.z -= dz * k * 0.4; moved = true; }
  }
  if (moved) {
    P.mesh.position.x = x; P.mesh.position.z = z;
    P.body.setTranslation({ x, y: P.mesh.position.y, z }, true);
  }
}

// Carro do André contra carros estacionados (o trânsito é tratado no TrafficController)
export function resolveParked(g) {
  const pv = g.player.vehicle;
  if (!pv) return 0;
  let impact = 0;
  for (const v of [...g.parked, ...g.extraCars()]) {
    if (v === pv || Math.abs(v.pos.x - pv.pos.x) > 9 || Math.abs(v.pos.z - pv.pos.z) > 9) continue;
    const r = carVsCar(pv, v);
    if (r.d >= 0) continue;
    pv.pos.x -= r.nx * r.d; pv.pos.z -= r.nz * r.d;
    g.phys.carBody.setTranslation({ x: pv.pos.x, y: 0, z: pv.pos.z }, true);
    const rel = Math.abs(pv.vx * r.nx + pv.vz * r.nz);
    if (rel > 1.5) { impact = Math.max(impact, rel); pv.speed *= 0.35; }
  }
  return impact;
}
