// Controles de toque para celular/tablet: joystick à esquerda, arrastar à direita gira a câmera,
// botões de ação. Eles "apertam" as mesmas teclas do teclado (Input.virtual), então o jogo não muda.
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;

export class TouchControls {
  constructor(input, game) {
    this.input = input;
    this.game = game;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-stick-zone"><div class="t-base"><div class="t-knob"></div></div></div>
      <div class="t-look-zone"></div>
      <div class="t-buttons">
        <button data-tap="KeyE" class="t-big">E</button>
        <button data-hold="Space" class="t-mid t-jump">⤒</button>
        <button data-hold="KeyH" class="t-mid t-horn">📯</button>
        <button data-tap="KeyJ" class="t-mid t-job">📦</button>
      </div>
      <div class="t-top">
        <button data-tap="KeyG">⚙</button>
        <button data-tap="KeyM">🔊</button>
        <button data-tap="KeyP">⏸</button>
      </div>`;
    document.getElementById('hud').appendChild(root);
    this.base = root.querySelector('.t-base');
    this.knob = root.querySelector('.t-knob');
    this.horn = root.querySelector('.t-horn');
    this.job = root.querySelector('.t-job');
    this.jump = root.querySelector('.t-jump');
    this._stick(root.querySelector('.t-stick-zone'));
    this._look(root.querySelector('.t-look-zone'));
    for (const b of root.querySelectorAll('button')) this._button(b);
  }

  _stick(zone) {
    let id = null, ox = 0, oy = 0;
    const set = (dx, dy) => {
      const R = 55, len = Math.min(1, Math.hypot(dx, dy) / R), a = Math.atan2(dy, dx);
      const x = Math.cos(a) * len, y = Math.sin(a) * len;
      Object.assign(this.input.axis, { x, y, active: len > 0.08 });
      this.knob.style.transform = `translate(${x * R}px, ${y * R}px)`;
      const v = this.input.virtual;
      for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft']) v.delete(k);
      if (y < -0.35) v.add('KeyW');
      if (y > 0.35) v.add('KeyS');
      if (x < -0.35) v.add('KeyA');
      if (x > 0.35) v.add('KeyD');
      if (len > 0.95 && !this.game.player?.vehicle) v.add('ShiftLeft'); // joystick no limite = correr
    };
    zone.addEventListener('pointerdown', (e) => {
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      try { zone.setPointerCapture(id); } catch { /* toque já terminou */ }
      const r = zone.getBoundingClientRect();
      this.base.style.left = `${ox - r.left - 60}px`;
      this.base.style.top = `${oy - r.top - 60}px`;
      this.base.classList.add('on');
      set(0, 0);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - ox, e.clientY - oy); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; set(0, 0); this.base.classList.remove('on'); this.knob.style.transform = ''; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _look(zone) {
    let id = null, lx = 0, ly = 0;
    zone.addEventListener('pointerdown', (e) => { id = e.pointerId; lx = e.clientX; ly = e.clientY; try { zone.setPointerCapture(id); } catch { /* toque já terminou */ } });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      this.input.dx += (e.clientX - lx) * 1.6;
      this.input.dy += (e.clientY - ly) * 1.6;
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === id) id = null; };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _button(b) {
    const tap = b.dataset.tap, hold = b.dataset.hold;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      b.classList.add('down');
      if (tap) this.input.tap(tap);
      if (hold) { this.input.virtual.add(hold); this.input.tap(hold); }
    });
    const up = () => { b.classList.remove('down'); if (hold) this.input.virtual.delete(hold); };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }

  // mostra a buzina só dentro do carro e troca o ícone do pulo para freio de mão
  update() {
    const inCar = !!this.game.player?.vehicle;
    this.horn.style.display = inCar ? '' : 'none';
    this.job.style.display = this.game.jobs?.offer ? '' : 'none'; // aceitar entrega
    this.jump.textContent = inCar ? '⛔' : '⤒';
  }
}
