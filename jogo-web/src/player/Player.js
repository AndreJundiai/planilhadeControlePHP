import { makeHuman, animateHuman, ANDRE_LOOK } from '../entities/Human.js';
import { makeRealHuman, animateRealHuman, realHumanReady } from '../entities/RealHuman.js';
import { driveArcade } from './Vehicle.js';
import { lerpAngle } from '../core/math.js';

// André: anda a pé (character controller Rapier) ou dirige um Vehicle.
export class Player {
  constructor(scene, phys, x, z) {
    this.phys = phys;
    const R = phys.R;
    // André realista (modelo escaneado); se não carregar, usa o boneco simples
    this.real = realHumanReady() ? makeRealHuman(null) : null;
    this.mesh = this.real ? this.real.root : makeHuman(ANDRE_LOOK, true);
    this.mesh.position.set(x, 0.05, z);
    scene.add(this.mesh);
    this.body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, 0.05, z));
    this.collider = phys.world.createCollider(R.ColliderDesc.capsule(0.6, 0.3).setTranslation(0, 0.9, 0), this.body);
    this.ctrl = phys.world.createCharacterController(0.02);
    this.ctrl.enableSnapToGround(0.4);
    this.vy = 0;
    this.health = 100;
    this.vehicle = null;
    this.phase = 0;
    this.heading = 0;
    this.footSpeed = 0;
    this.grounded = true;
    this.hasBriefcase = false;
    this.hasGroceries = false;
    this.money = 150;
  }
  get pos() { return this.vehicle ? this.vehicle.pos : this.mesh.position; }
  get speed() { return this.vehicle ? Math.abs(this.vehicle.speed) : this.footSpeed; }

  teleport(x, z) {
    if (this.vehicle) this.exitVehicle();
    this.phys.teleport(this.body, x, 0.05, z);
    this.mesh.position.set(x, 0.05, z);
    this.vy = 0;
  }

  updateFoot(dt, input, yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx;
    const ax = input.axis;
    // joystick analógico (celular) ou teclas; o quanto empurra decide andar ou correr
    const fw = ax.active ? -ax.y : (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    const st = ax.active ? ax.x : (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let mx = fx * fw + rx * st, mz = fz * fw + rz * st;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const push = Math.min(1, l);
    const sp = ax.active ? (push > 0.9 ? 6 : 1.2 + push * 2.4) : input.down('ShiftLeft', 'ShiftRight') ? 6 : 3.2;
    // aceleração suave (sem ir de 0 a 100% num quadro)
    this.vx = (this.vx || 0) + (mx * sp - (this.vx || 0)) * Math.min(1, 10 * dt);
    this.vz = (this.vz || 0) + (mz * sp - (this.vz || 0)) * Math.min(1, 10 * dt);
    if (this.grounded && input.hit('Space')) this.vy = 6;
    else if (!this.grounded) this.vy -= 20 * dt;
    else this.vy = Math.min(this.vy, -1);
    const res = this.phys.move(this.ctrl, this.body, this.collider, { x: this.vx * dt, y: this.vy * dt, z: this.vz * dt });
    this.grounded = res.grounded;
    if (res.pos.y < 0.02) { // não afunda no chão
      res.pos.y = 0.02;
      this.body.setNextKinematicTranslation(res.pos);
      this.grounded = true;
    }
    this.mesh.position.set(res.pos.x, res.pos.y, res.pos.z);
    const real = Math.hypot(this.vx, this.vz), moving = real > 0.25;
    this.footSpeed = real;
    if (moving) { this.heading = lerpAngle(this.heading, Math.atan2(this.vx, this.vz), 12 * dt); this.phase += dt * (real > 4.5 ? 9.5 : 1.8 * real); }
    this.mesh.rotation.y = this.heading;
    if (this.real) animateRealHuman(this.real, dt, moving ? real : 0);
    else animateHuman(this.mesh, this.phase, !moving ? 0 : real > 4.5 ? 1 : 0.6);
  }

  enterVehicle(v) {
    this.vehicle = v;
    this.mesh.visible = false;
    this.collider.setEnabled(false);
    this.phys.teleport(this.phys.carBody, v.pos.x, 0, v.pos.z, v.heading);
  }

  exitVehicle(insideBuilding = () => false) {
    const v = this.vehicle;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const spots = [[-fz * 2.2, fx * 2.2], [fz * 2.2, -fx * 2.2], [-fx * 3.4, -fz * 3.4], [fx * 3.4, fz * 3.4]];
    const [ox, oz] = spots.find(([a, b]) => !insideBuilding(v.pos.x + a, v.pos.z + b)) || spots[0];
    this.vehicle = null;
    v.speed = v.lat = 0;
    this.mesh.visible = true;
    this.collider.setEnabled(true);
    this.teleport(v.pos.x + ox, v.pos.z + oz);
    this.heading = v.heading;
    return v;
  }

  updateCar(dt, input) { return driveArcade(this.vehicle, dt, input, this.phys); }
}
