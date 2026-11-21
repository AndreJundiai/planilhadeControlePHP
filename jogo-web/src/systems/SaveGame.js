// Progresso salvo no aparelho (missão, dinheiro, posição). Salva sozinho a cada 15 s e ao concluir missão.
const KEY = 'autotheft-save-v1';

export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.v === 1 ? s : null; } catch { return null; }
}

export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* sem localStorage */ } }

export function writeSave(g) {
  const P = g.player, p = P.pos;
  const data = { v: 1, mission: g.missions.pending ? g.missions.pending.next : g.missions.i, money: Math.round(P.money * 100) / 100,
    x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, day: g.clock?.day || 1, hour: Math.round((g.clock?.hour ?? 7) * 100) / 100, jobs: g.jobs?.done || 0, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* sem espaço / modo anônimo */ }
  return data;
}
