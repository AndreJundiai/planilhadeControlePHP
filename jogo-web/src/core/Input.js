// Teclado + mouse (pointer lock). `hit` = apertou neste quadro.
export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.virtual = new Set(); // teclas "apertadas" pelos controles de toque
    this.axis = { x: 0, y: 0, active: false }; // joystick analógico (-1..1); y negativo = para frente
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('click', () => dom.requestPointerLock?.());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === dom) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
  }
  down(...codes) { return codes.some((c) => this.keys.has(c) || this.virtual.has(c)); }
  tap(code) { this.pressed.add(code); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.dx = this.dy = 0; }
}
