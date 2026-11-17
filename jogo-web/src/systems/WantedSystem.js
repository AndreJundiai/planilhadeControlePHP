// Nível de procurado (0 a 3 estrelas). Cai sozinho se nenhuma viatura vir o jogador por um tempo.
export class WantedSystem {
  constructor(hud) {
    this.hud = hud;
    this.level = 0;
    this.hide = 0;
  }
  get hideNeeded() { return 8 + this.level * 4; }
  add(n, reason) {
    const before = this.level;
    this.level = Math.min(3, this.level + n);
    this.hide = 0;
    if (this.level > before) this.hud.toast(`★ PROCURADO — ${reason}`, '#ff5050');
  }
  set(n, reason) { if (n > this.level) this.add(n - this.level, reason); }
  clear() { this.level = 0; this.hide = 0; }
  update(dt, px, pz, police) {
    if (!this.level) return;
    const seen = police.some((c) => c.active && c.spawned && Math.hypot(c.v.pos.x - px, c.v.pos.z - pz) < 70);
    if (seen) { this.hide = 0; return; }
    this.hide += dt;
    if (this.hide > this.hideNeeded) {
      this.level--;
      this.hide = 0;
      this.hud.toast(this.level ? 'Nível de procurado caiu' : 'Você despistou a polícia!', '#7dff7d');
    }
  }
}
