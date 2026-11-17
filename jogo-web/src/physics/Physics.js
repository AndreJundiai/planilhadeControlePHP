import RAPIER from '@dimforge/rapier3d-compat';

// Mundo Rapier3D (WASM): chão, paredes dos prédios (trimesh) e o corpo do carro do jogador.
export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }
  constructor() {
    const R = (this.R = RAPIER);
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.createCollider(R.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0));
    // Um único corpo cinemático de carro, reaproveitado pelo veículo que o jogador dirige/estacionou.
    this.carBody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    this.carCollider = this.world.createCollider(R.ColliderDesc.cuboid(0.92, 0.55, 2.1).setTranslation(0, 0.75, 0), this.carBody);
    this.carCtrl = this.world.createCharacterController(0.05);
    this.carCtrl.setSlideEnabled(true);
  }
  addStatic(verts, idx) {
    return verts.length ? this.world.createCollider(this.R.ColliderDesc.trimesh(verts, idx)) : null;
  }
  removeStatic(c) { if (c) this.world.removeCollider(c, false); }
  // Move um corpo cinemático com o character controller (desliza nas paredes).
  move(ctrl, body, collider, d, lockY = null) {
    ctrl.computeColliderMovement(collider, d);
    const m = ctrl.computedMovement();
    const p = body.translation();
    const n = { x: p.x + m.x, y: lockY ?? p.y + m.y, z: p.z + m.z };
    body.setNextKinematicTranslation(n);
    return { pos: n, moved: m, grounded: ctrl.computedGrounded() };
  }
  teleport(body, x, y, z, h = null) {
    body.setTranslation({ x, y, z }, true);
    body.setNextKinematicTranslation({ x, y, z });
    if (h !== null) {
      const q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
      body.setRotation(q, true);
      body.setNextKinematicRotation(q);
    }
  }
  // Distância livre até a primeira parede (usada pela câmera).
  rayDist(from, dir, max) {
    const hit = this.world.castRay(new this.R.Ray(from, dir), max, true, this.R.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit ? hit.timeOfImpact : max;
  }
  step(dt) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
