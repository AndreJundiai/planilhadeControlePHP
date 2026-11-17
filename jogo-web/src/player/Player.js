import { makeHuman, animateHuman } from '../entities/Human.js';
import { driveArcade } from './Vehicle.js';
import { lerpAngle } from '../core/math.js';

// André: anda a pé (character controller Rapier) ou dirige um Vehicle.
export class Player {
  constructor(scene, phys, x, z) {
    this.phys = phys;
    const R = phys.R;
    this.mesh = makeHuman({ shirt: 0x1d5fbf, pants: 0x26334d, skin: 0xc4906a, hair: 0x1a120c });
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
    const fw = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    const st = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let mx = fx * fw + rx * st, mz = fz * fw + rz * st;
    const l = Math.hypot(mx, mz);
    if (l > 1) { mx /= l; mz /= l; }
    const sp = input.down('ShiftLeft', 'ShiftRight') ? 7 : 3.2;
    if (this.grounded && input.hit('Space')) this.vy = 6;
    else if (!this.grounded) this.vy -= 20 * dt;
    else this.vy = Math.min(this.vy, -1);
    const res = this.phys.move(this.ctrl, this.body, this.collider, { x: mx * sp * dt, y: this.vy * dt, z: mz * sp * dt });
    this.grounded = res.grounded;
    this.mesh.position.set(res.pos.x, res.pos.y, res.pos.z);
    const moving = l > 0.1;
    this.footSpeed = moving ? sp : 0;
    if (moving) { this.heading = lerpAngle(this.heading, Math.atan2(mx, mz), 12 * dt); this.phase += dt * sp * 2.4; }
    this.mesh.rotation.y = this.heading;
    animateHuman(this.mesh, this.phase, moving ? 0.7 : 0);
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
