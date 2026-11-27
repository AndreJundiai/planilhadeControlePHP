// Menu de pausa: P / Esc (ao soltar o mouse) no PC, botão ⏸ no celular.
export class PauseMenu {
  constructor(game) {
    this.g = game;
    const el = (this.el = document.createElement('div'));
    el.id = 'pause';
    el.innerHTML = `<div class="pm-box"><h2>PAUSA</h2>
      <button data-a="resume">▶ CONTINUAR</button>
      <button data-a="quality"></button>
      <button data-a="sound"></button>
      <button data-a="radio"></button>
      <button data-a="perf"></button>
      <button data-a="restart">↺ REINICIAR MISSÃO</button>
      <button data-a="title">⌂ SALVAR E VOLTAR AO TÍTULO</button>
      <small>Progresso salvo automaticamente</small></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { const a = e.target.dataset?.a; if (a) this[a](); });
  }
  get open() { return this.el.classList.contains('show'); }
  refresh() {
    const q = this.g.quality, s = this.g.sound;
    this.el.querySelector('[data-a=quality]').textContent = `⚙ GRÁFICOS: ${q.p.label.toUpperCase()}${q.auto ? ' (AUTO)' : ''}`;
    this.el.querySelector('[data-a=sound]').textContent = `🔊 SOM: ${s?.muted ? 'DESLIGADO' : 'LIGADO'}`;
    this.el.querySelector('[data-a=radio]').textContent = `📻 RÁDIO DO CARRO: ${s?.radioOn ? 'LIGADO' : 'DESLIGADO'}`;
    this.el.querySelector('[data-a=perf]').textContent = `📊 MEDIDOR DE DESEMPENHO: ${this.g.prof?.on ? 'LIGADO' : 'DESLIGADO'}`;
  }
  show() { if (this.g.paused) return; this.g.paused = true; this.g.menuPaused = true; this.refresh(); this.el.classList.add('show'); }
  resume() { this.el.classList.remove('show'); this.g.menuPaused = false; this.g.paused = false; this.g.frameTimer.getDelta(); }
  quality() { this.g.quality.cycle(); this.refresh(); }
  sound() { this.g.sound?.toggleMute(); this.refresh(); }
  radio() { this.g.sound?.toggleRadio(); this.refresh(); }
  perf() { this.g.prof?.toggle(); this.refresh(); }
  restart() { this.resume(); this.g.missions.fail('Reiniciada pelo jogador'); }
  title() { this.g.save(); location.reload(); }
}
