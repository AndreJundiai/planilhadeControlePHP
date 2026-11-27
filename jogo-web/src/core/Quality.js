import { QUALITY } from '../config.js';
import { isTouchDevice } from '../ui/TouchControls.js';

const ORDER = ['baixo', 'medio', 'alto'];

// Ajusta resolução, sombras, distância de visão e quantidade de NPCs/carros.
// Modo automático: mede o FPS e baixa o nível se o jogo ficar lento.
export class Quality {
  constructor(game) {
    this.g = game;
    let saved = null;
    try { saved = localStorage.getItem('quality'); } catch { /* sem localStorage */ }
    this.auto = !saved;
    this.mobile = isTouchDevice();
    this.key = QUALITY[saved] ? saved : this.mobile ? 'baixo' : 'medio'; // celular começa no Baixo
    this.frames = 0;
    this.time = 0;
    this.fps = 0;
    this.slow = 0;
  }
  get p() { return QUALITY[this.key]; }

  apply(announce = false) {
    const g = this.g, p = this.p;
    g.renderer.setPixelRatio(Math.min(devicePixelRatio, p.pixelRatio));
    g.sun.castShadow = p.shadows;
    if (g.sun.shadow.mapSize.x !== p.shadowSize) {
      g.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      g.sun.shadow.map?.dispose();
      g.sun.shadow.map = null;
    }
    g.scene.fog.density = 2 / p.far; // neblina exponencial: esconde o horizonte e o fim dos blocos do mapa
    g.camera.far = p.far + 60;
    g.camera.updateProjectionMatrix();
    g.postfx?.setQuality({ bloom: p.bloom, ao: p.ao, pixelRatio: Math.min(devicePixelRatio, p.pixelRatio), iv: p.iv ?? 1, blur: !!p.blur });
    g.npc?.setActive(p.peds, false);
    g.realCrowd?.setMax(this.mobile ? Math.min(2, p.realPeds || 0) : p.realPeds || 0); // celular: no máximo 2 realistas
    g.traffic?.setActive(p.traffic);
    if (announce) g.hud.toast(`Gráficos: ${p.label}${this.auto ? ' (automático)' : ''}`, '#9fd3ff');
  }

  cycle() {
    this.auto = false;
    this.key = ORDER[(ORDER.indexOf(this.key) + 1) % ORDER.length];
    try { localStorage.setItem('quality', this.key); } catch { /* sem localStorage */ }
    this.apply(true);
  }

  update(dt) {
    this.frames++;
    this.time += dt;
    if (this.time < 2) return;
    this.fps = Math.round(this.frames / this.time);
    this.frames = 0;
    this.time = 0;
    if (!this.auto) return;
    this.slow = this.fps < 30 ? this.slow + 1 : 0;
    const i = ORDER.indexOf(this.key);
    if (this.slow >= 2 && i > 0) { // 4 s seguidos abaixo de 30 FPS
      this.key = ORDER[i - 1];
      this.slow = 0;
      this.apply(true);
    }
  }
}
