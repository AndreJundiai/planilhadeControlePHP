import { makeRealHuman, animateRealHuman, realHumanReady, REAL_VARIANTS } from '../entities/RealHuman.js';

/**
 * LOD for pedestrians: the N closest "casual male" NPCs are drawn with the realistic model;
 * everyone else (farther away, women, uniforms) stays on the cheap instanced low-poly crowd.
 */
const REAL_KINDS = new Set(['casual', 'jovem', 'turista', 'entregador']);

export class RealCrowd {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.max = 0;
    this.range = 35; // LOD: realistas só bem perto (cada um tem ~21 mil triângulos)
  }

  setMax(n) { this.max = n; }

  eligible(p) {
    const l = p.look;
    return l && l.body !== 'f' && !l.dress && !l.skirt && REAL_KINDS.has(l.kind);
  }

  // Returns the set of pedestrians drawn here this frame (the crowd renderer skips them).
  update(dt, peds, px, pz) {
    const taken = new Set();
    if (!realHumanReady() || this.max === 0) { for (const h of this.pool) h.root.visible = false; return taken; }
    const cand = [];
    for (const p of peds) {
      if (!p.spawned || !p.mesh.visible || !this.eligible(p)) continue;
      const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
      if (d < this.range) cand.push([d, p]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const chosen = cand.slice(0, this.max).map((c) => c[1]);
    while (this.pool.length < chosen.length) {
      const h = makeRealHuman(REAL_VARIANTS[this.pool.length % REAL_VARIANTS.length]);
      h.owner = null;
      this.scene.add(h.root);
      this.pool.push(h);
    }
    // mantém o mesmo clone para o mesmo pedestre (a roupa não "pula" de um para outro)
    const free = this.pool.filter((h) => !chosen.includes(h.owner));
    for (const p of chosen) {
      let h = this.pool.find((x) => x.owner === p);
      if (!h) { h = free.shift(); h.owner = p; }
      const src = p.mesh;
      h.root.visible = true;
      h.root.position.copy(src.position);
      h.root.rotation.copy(src.rotation);
      h.root.scale.setScalar(src.scale.x);
      animateRealHuman(h, dt, p.curSpeed || 0);
      taken.add(p);
    }
    for (const h of free) { h.root.visible = false; h.owner = null; }
    return taken;
  }
}
