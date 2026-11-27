// Medidor de desempenho: tempo (ms) de cada sistema por quadro, média móvel. F3 mostra na tela.
export class Profiler {
  constructor(renderer) {
    this.r = renderer;
    this.avg = {};
    this.frame = 0;
    this.el = null;
    this.on = false;
    this.fpsMin = Infinity;
    this._win = [];
    this.cur = {};
    this.spikes = []; // quadros lentos (> 33 ms de CPU) com o que pesou em cada um
    renderer.info.autoReset = false; // soma todas as passadas do pós-processamento no quadro
  }
  begin() {
    const now = performance.now();
    if (this.t0) { this._win.push(now - this.t0); if (this._win.length > 120) this._win.shift(); } // últimos 120 quadros
    this.t = now; this.t0 = now; this.cur = {}; this.r.info.reset();
  }
  mark(name) {
    const now = performance.now(), dt = now - this.t;
    this.t = now;
    this.cur[name] = (this.cur[name] || 0) + dt;
    this.avg[name] = (this.avg[name] ?? dt) * 0.92 + dt * 0.08;
  }
  end() {
    this.mark('total_cpu');
    this.avg.total_cpu = Object.entries(this.avg).filter(([k]) => k !== 'total_cpu').reduce((a, [, v]) => a + v, 0);
    const tot = Object.entries(this.cur).filter(([k]) => k !== 'total_cpu').reduce((a, [, v]) => a + v, 0);
    if (tot > 33) { this.spikes.push({ t: performance.now(), ms: +tot.toFixed(1), top: Object.entries(this.cur).filter(([k]) => k !== 'total_cpu').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ') }); if (this.spikes.length > 40) this.spikes.shift(); }
    this.calls = this.r.info.render.calls;
    this.tris = this.r.info.render.triangles;
    if (this.on && ++this.frame % 15 === 0) this._draw();
  }
  toggle() {
    this.on = !this.on;
    if (!this.el) { this.el = document.createElement('pre'); this.el.id = 'profiler'; document.getElementById('hud').appendChild(this.el); }
    this.el.style.display = this.on ? 'block' : 'none';
  }
  stats() {
    const w = this._win, avg = w.reduce((a, b) => a + b, 0) / (w.length || 1), worst = Math.max(...w, 0);
    const m = this.r.info.memory, heap = performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null;
    return { fps: avg ? 1000 / avg : 0, fpsMin: worst ? 1000 / worst : 0, geometries: m.geometries, textures: m.textures, programs: this.r.info.programs?.length || 0, heapMB: heap };
  }
  report() {
    return { ms: Object.fromEntries(Object.entries(this.avg).map(([k, v]) => [k, +v.toFixed(2)])), drawCalls: this.calls, triangles: this.tris, ...this.stats() };
  }
  _draw() {
    const rows = Object.entries(this.avg).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.padEnd(10)} ${v.toFixed(2).padStart(6)} ms`);
    const s = this.stats();
    this.el.textContent = `DESEMPENHO (F3 ou Pausa)\nFPS ${s.fps.toFixed(0)} · pior quadro ${s.fpsMin.toFixed(0)}\n${rows.join('\n')}\n` +
      `chamadas ${this.calls} · triângulos ${(this.tris / 1000).toFixed(0)} mil\n` +
      `geometrias ${s.geometries} · texturas ${s.textures} · shaders ${s.programs}` + (s.heapMB ? `\nmemória JS ${s.heapMB.toFixed(0)} MB` : '');
  }
}
