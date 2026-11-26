import { clamp, lerpAngle } from '../core/math.js';

// Câmera orbital em 3ª pessoa: mouse gira, alinha atrás do carro sozinha e não atravessa prédios.
export class CameraRig {
  constructor(camera, phys) {
    this.cam = camera;
    this.phys = phys;
    this.yaw = Math.PI;
    this.pitch = 0.35;
    this.dist = 4.5;
    this.idle = 0;
  }
  update(dt, input, player) {
    if (input.dx || input.dy) {
      this.yaw -= input.dx * 0.0025;
      this.pitch = clamp(this.pitch + input.dy * 0.0025, -0.15, 1.2);
      this.idle = 0;
    } else this.idle += dt;
    const v = player.vehicle;
    if (v && this.idle > 1.0) {
      this.yaw = lerpAngle(this.yaw, v.heading + Math.PI, 2.5 * dt);
      this.pitch += (0.28 - this.pitch) * Math.min(1, 2 * dt);
    }
    const wantD = v ? 8 + Math.abs(v.speed) * 0.08 : 4.2;
    this.dist += (wantD - this.dist) * Math.min(1, 3 * dt);
    const p = player.pos;
    const target = { x: p.x, y: (v ? 0 : p.y) + (v ? 1.7 : 1.55), z: p.z };
    const dir = { x: Math.sin(this.yaw) * Math.cos(this.pitch), y: Math.sin(this.pitch), z: Math.cos(this.yaw) * Math.cos(this.pitch) };
    const d = Math.max(0.6, Math.min(this.dist, this.phys.rayDist(target, dir, this.dist) - 0.3));
    // física e lógica ficam no plano; só a imagem tem relevo, então a câmera soma a altura do terreno
    const H = this.heightAt || (() => 0), hp = H(p.x, p.z);
    const cx = target.x + dir.x * d, cz = target.z + dir.z * d;
    this.cam.position.set(cx, Math.max(H(cx, cz) + 0.5, hp + Math.max(0.4, target.y + dir.y * d)), cz);
    this.cam.lookAt(target.x, target.y + hp, target.z);
    const fov = 70 + (v ? Math.abs(v.speed) * 0.35 : 0);
    if (Math.abs(this.cam.fov - fov) > 0.05) { this.cam.fov += (fov - this.cam.fov) * Math.min(1, 3 * dt); this.cam.updateProjectionMatrix(); }
  }
}
