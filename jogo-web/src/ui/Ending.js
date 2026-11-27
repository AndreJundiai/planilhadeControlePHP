/**
 * Tela de FIM da história (depois da missão final "Acerto de Contas").
 * Mostra o resumo da jornada do André e os créditos; o jogador pode continuar explorando Jundiaí.
 */
const brl = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');

export class Ending {
  constructor(game) {
    this.g = game;
    this.shown = false;
  }

  show() {
    if (this.shown) return;
    this.shown = true;
    const g = this.g, P = g.player, mins = Math.round(g.time / 60);
    g.paused = true;
    g.menuPaused = true;
    document.exitPointerLock?.();
    g.sound?.ending?.();
    const el = document.createElement('div');
    el.id = 'ending';
    el.innerHTML = `
      <div class="en-sky"></div>
      <div class="en-box">
        <div class="en-fim">FIM</div>
        <div class="en-sub">André voltou pra casa. O chefe caiu, o dinheiro da Festa da Uva voltou e Jundiaí seguiu em frente.</div>
        <div class="en-stats">
          <div><b>${g.missions.count}</b><span>missões</span></div>
          <div><b>${brl(P.money)}</b><span>no bolso</span></div>
          <div><b>${g.clock.day}</b><span>dias em Jundiaí</span></div>
          <div><b>${g.jobs.done}</b><span>entregas</span></div>
          <div><b>${mins} min</b><span>jogando</span></div>
        </div>
        <div class="en-credits">
          <h3>AUTO THEFT JUNDIAÍ</h3>
          <p>Mapa: © colaboradores do OpenStreetMap · Relevo: SRTM (NASA) via AWS Open Data</p>
          <p>Pedestre realista: "Nathan Animated 003" por Renderpeople (CC-BY 4.0)</p>
          <p>Gráficos, sons e cidade gerados por código em three.js e Web Audio</p>
          <p>Feito em Jundiaí-SP</p>
        </div>
        <button class="en-go">CONTINUAR EXPLORANDO JUNDIAÍ</button>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    el.querySelector('.en-go').onclick = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 600);
      g.menuPaused = false;
      g.paused = false;
      g.frameTimer.getDelta();
      g.hud.toast('Modo livre: Jundiaí é sua', '#ffd400');
      g.save();
    };
  }
}
