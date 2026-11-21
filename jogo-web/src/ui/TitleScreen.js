// Abertura do Auto Theft Jundiaí: tela de título (o mapa carrega por trás), menu e introdução em cartelas.
const INTRO = [
  'Jundiaí, interior de São Paulo.',
  'Rua do Retiro. Sete da manhã.',
  'André só queria comprar pão no Dom Olívio...',
  '...mas a cidade tinha outros planos.',
];

const SKYLINE = (() => {
  // prédios da cidade (silhueta) gerados com sementes fixas
  let x = 0, d = '';
  const r = (i) => { const v = Math.sin(i * 91.7) * 43758.5; return v - Math.floor(v); };
  for (let i = 0; x < 1600; i++) {
    const w = 26 + r(i) * 60, h = 40 + r(i + 7) * (i % 7 === 3 ? 230 : 120);
    d += `M${x},300 V${300 - h} H${x + w} V300 Z `;
    x += w + 4 + r(i + 3) * 10;
  }
  return d;
})();

export class TitleScreen {
  constructor({ onPlay, onQuality, onSound, qualityLabel, soundLabel, save, onNew }) {
    this.onPlay = onPlay;
    this.save = save;
    this.onNew = onNew;
    const el = (this.el = document.createElement('div'));
    el.id = 'title';
    el.innerHTML = `
      <div class="tt-sky"></div><div class="tt-sun"></div>
      <svg class="tt-serra" viewBox="0 0 1600 300" preserveAspectRatio="none"><path d="M0,300 L0,190 C120,150 220,120 330,140 C420,155 470,95 560,80 C650,66 700,120 790,110 C900,98 960,40 1060,52 C1160,64 1210,130 1320,120 C1420,112 1500,150 1600,140 L1600,300 Z"/></svg>
      <svg class="tt-city" viewBox="0 0 1600 300" preserveAspectRatio="none"><path d="${SKYLINE}"/></svg>
      <div class="tt-road"><span></span><span></span><span></span></div>
      <div class="tt-logo"><div class="tt-auto">AUTO THEFT</div><div class="tt-city-name">JUNDIAÍ</div><div class="tt-sub">mundo aberto · ruas reais da cidade</div></div>
      <div class="tt-menu">
        <button class="tt-play" disabled>CARREGANDO...</button>
        <button class="tt-new" style="display:none">✦ NOVO JOGO</button>
        <button class="tt-q"></button>
        <button class="tt-s"></button>
        <button class="tt-c">CRÉDITOS</button>
      </div>
      <div class="tt-load"><div class="tt-bar"><div></div></div><span></span></div>
      <div class="tt-credits"><b>Auto Theft Jundiaí</b> — protótipo de fã, sem ligação com Rockstar Games.<br>
        Mapa © colaboradores do OpenStreetMap · OpenFreeMap · Física Rapier · Three.js<br>
        Modelo humano “Nathan Animated 003” por Renderpeople (CC-BY 4.0)<br><button>VOLTAR</button></div>
      <div class="tt-intro"><p></p><small>toque para pular</small></div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    this.play = $('.tt-play');
    const q = $('.tt-q'), s = $('.tt-s');
    const refresh = () => { q.textContent = 'GRÁFICOS: ' + qualityLabel().toUpperCase(); s.textContent = 'SOM: ' + soundLabel().toUpperCase(); };
    refresh();
    q.onclick = () => { onQuality(); refresh(); };
    s.onclick = () => { onSound(); refresh(); };
    $('.tt-c').onclick = () => el.classList.add('show-credits');
    $('.tt-credits button').onclick = () => el.classList.remove('show-credits');
    this.play.onclick = () => (this.save ? this._go() : this._intro());
    const nw = $('.tt-new');
    nw.onclick = () => { this.onNew(); this.save = null; this._intro(); };
    this.newBtn = nw;
    this.bar = $('.tt-bar div');
    this.loadText = $('.tt-load span');
  }

  // espelha a barra da tela de carregamento enquanto o título está aberto
  progress(pct, text) {
    this.bar.style.width = pct + '%';
    this.loadText.textContent = `${Math.round(pct)}% · ${text}`;
  }

  ready() {
    this.play.disabled = false;
    this.play.textContent = this.save ? `▶ CONTINUAR (missão ${this.save.mission + 1})` : '▶ JOGAR';
    if (this.save) this.newBtn.style.display = '';
    this.el.classList.add('ready');
  }

  // continuar: sem a introdução
  _go() {
    this.el.classList.add('out');
    setTimeout(() => this.el.remove(), 900);
    this.onPlay(this.save);
  }

  _intro() {
    const box = this.el.querySelector('.tt-intro'), p = box.querySelector('p');
    this.el.classList.add('intro');
    let i = 0, done = false, timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.el.classList.add('out');
      setTimeout(() => this.el.remove(), 900);
      this.onPlay();
    };
    const next = () => {
      if (i >= INTRO.length) return finish();
      p.classList.remove('on');
      setTimeout(() => { p.textContent = INTRO[i++]; p.classList.add('on'); }, 250);
      timer = setTimeout(next, 2600);
    };
    box.onclick = finish;
    next();
  }
}
