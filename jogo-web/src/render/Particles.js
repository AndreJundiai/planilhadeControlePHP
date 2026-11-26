import * as THREE from 'three';
import { softDotTexture } from './ProceduralTextures.js';
import { heightAt } from './Terrain.js';

/**
 * Partículas nativas com pooling: um único THREE.Points por tipo (1 draw call cada) e um vetor fixo
 * de partículas que é reaproveitado — nada é criado nem destruído durante o jogo (sem lixo para o GC).
 *  - Fumaça de pneu: cinza translúcida, cresce, sobe devagar e some (derrapagem, freada, arrancada).
 *  - Faíscas: laranja/amarelas aditivas, com gravidade e quique no chão (colisões).
 */
const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uTex;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float a = texture2D(uTex, gl_PointCoord).r * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class Pool {
  constructor(scene, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.color = new Float32Array(max * 3);
    this.life = new Float32Array(max); // segundos restantes (0 = livre)
    this.total = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.floor = new Float32Array(max); // altura do chão onde a partícula nasceu (relevo)
    this.next = 0;
    this.alive = 0;
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: softDotTexture() }, uScale: { value: 400 } },
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  // pega a próxima vaga (circular): se o pool está cheio, recicla a partícula mais antiga
  spawn(x, y, z, vx, vy, vz, size, life, grow, alpha, r, g, b) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (this.life[i] <= 0) this.alive++;
    const j = i * 3, P = this.pos, V = this.vel, C = this.color, gy = heightAt(x, z);
    this.floor[i] = gy;
    P[j] = x; P[j + 1] = y + gy; P[j + 2] = z;
    V[j] = vx; V[j + 1] = vy; V[j + 2] = vz;
    C[j] = r; C[j + 1] = g; C[j + 2] = b;
    this.size[i] = size;
    this.life[i] = this.total[i] = life;
    this.grow[i] = grow;
    this.a0[i] = this.alpha[i] = alpha;
  }

  update(dt, gravity, drag, bounce) {
    if (!this.alive) return;
    const P = this.pos, V = this.vel, k = Math.exp(-drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.alive--; continue; }
      const j = i * 3;
      V[j + 1] -= gravity * dt;
      V[j] *= k; V[j + 1] *= gravity ? 1 : k; V[j + 2] *= k;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      if (bounce && P[j + 1] < this.floor[i] + 0.03) { P[j + 1] = this.floor[i] + 0.03; V[j + 1] = Math.abs(V[j + 1]) * bounce; V[j] *= 0.6; V[j + 2] *= 0.6; }
      const t = this.life[i] / this.total[i]; // 1 → 0
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * (bounce ? t : Math.min(1, (1 - t) * 6) * t); // fumaça: aparece rápido e some devagar
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[n].needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, low = false) {
    this.smokePool = new Pool(scene, low ? 160 : 360, false);
    this.sparkPool = new Pool(scene, low ? 120 : 260, true);
    this._acc = 0;
  }

  /** Ajusta o tamanho na tela à altura da janela (chamar no resize). */
  resize(h, fov = 70) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.smokePool.mat.uniforms.uScale.value = s;
    this.sparkPool.mat.uniforms.uScale.value = s;
  }

  /** Fumaça saindo de um pneu (x,z), com o carro andando a (vx,vz). k = intensidade 0–1. */
  smoke(x, z, vx, vz, k = 1, wet = 0) {
    const tone = 0.62 + Math.random() * 0.2 + wet * 0.15; // na chuva vira vapor mais claro
    this.smokePool.spawn(
      x + (Math.random() - 0.5) * 0.3, 0.25, z + (Math.random() - 0.5) * 0.3,
      vx * 0.15 + (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.7, vz * 0.15 + (Math.random() - 0.5) * 1.2,
      0.8 + Math.random() * 0.5, 1.4 + Math.random() * 1.2 * k, 2.2 + k * 1.6, 0.32 + 0.25 * k, tone, tone, tone * 1.02);
  }

  /** Explosão de faíscas no ponto do impacto. power = velocidade do choque (m/s). */
  sparks(x, y, z, power = 10, dirX = 0, dirZ = 0) {
    const n = Math.min(70, 10 + Math.round(power * 2.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (3 + power * 0.45), up = 1.5 + Math.random() * 4.5;
      const hot = Math.random();
      this.sparkPool.spawn(x, y, z,
        Math.cos(a) * sp - dirX * sp * 0.4, up, Math.sin(a) * sp - dirZ * sp * 0.4,
        0.09 + Math.random() * 0.08, 0.35 + Math.random() * 0.55, -0.05, 1,
        1, 0.55 + hot * 0.4, 0.12 + hot * 0.25); // laranja → amarelo
    }
  }

  /**
   * Emite fumaça pelas rodas traseiras do carro quando ele derrapa, freia forte ou arranca cantando pneu.
   * v: veículo (pos, heading, speed, lat). Retorna a intensidade usada (0 = nada).
   */
  tyres(v, dt, { throttle = 0, brake = 0, hand = false, wet = 0 } = {}) {
    const spd = Math.abs(v.speed), slip = Math.abs(v.lat || 0);
    let k = 0;
    if (slip > 2.2 && spd > 5) k = Math.min(1, (slip - 2.2) / 5);                   // derrapagem / drift
    if (hand && spd > 6) k = Math.max(k, Math.min(1, spd / 20));                     // freio de mão
    if (brake > 0.5 && v.speed > 12) k = Math.max(k, 0.55);                          // freada brusca
    if (throttle > 0.5 && v.speed > 0.3 && v.speed < 7) k = Math.max(k, 0.45);       // arrancada
    if (k <= 0) { this._acc = 0; return 0; }
    this._acc += dt * (25 + 45 * k);
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading), rx = -fz, rz = fx;
    const vx = fx * v.speed, vz = fz * v.speed;
    while (this._acc >= 1) {
      this._acc -= 1;
      for (const side of [0.82, -0.82]) this.smoke(v.pos.x + rx * side - fx * 1.35, v.pos.z + rz * side - fz * 1.35, vx, vz, k, wet);
    }
    return k;
  }

  update(dt) {
    this.smokePool.update(dt, 0, 1.6, 0);
    this.sparkPool.update(dt, 14, 0.6, 0.35);
  }
}
