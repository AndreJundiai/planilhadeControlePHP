// Medidor de desempenho: tempo (ms) de cada sistema por quadro, média móvel. F3 mostra na tela.
export class Profiler {
  constructor(renderer) {
    this.r = renderer;
    this.avg = {};
    this.frame = 0;
    this.el = null;
    this.on = false;
    renderer.info.autoReset = false; // soma todas as passadas do pós-processamento no quadro
  }
  begin() { this.t = performance.now(); this.t0 = this.t; this.r.info.reset(); }
  mark(name) {
    const now = performance.now(), dt = now - this.t;
    this.t = now;
    this.avg[name] = (this.avg[name] ?? dt) * 0.92 + dt * 0.08;
  }
  end() {
    this.mark('total_cpu');
    this.avg.total_cpu = Object.entries(this.avg).filter(([k]) => k !== 'total_cpu').reduce((a, [, v]) => a + v, 0);
    this.calls = this.r.info.render.calls;
    this.tris = this.r.info.render.triangles;
    if (this.on && ++this.frame % 15 === 0) this._draw();
  }
  toggle() {
    this.on = !this.on;
    if (!this.el) { this.el = document.createElement('pre'); this.el.id = 'profiler'; document.getElementById('hud').appendChild(this.el); }
    this.el.style.display = this.on ? 'block' : 'none';
  }
  report() {
    return { ms: Object.fromEntries(Object.entries(this.avg).map(([k, v]) => [k, +v.toFixed(2)])), drawCalls: this.calls, triangles: this.tris };
  }
  _draw() {
    const rows = Object.entries(this.avg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2).padStart(6)} ms`);
    this.el.textContent = `DESEMPENHO (F3)\n${rows.join('\n')}\nchamadas ${this.calls}\ntriângulos ${(this.tris / 1000).toFixed(0)} mil`;
  }
}
