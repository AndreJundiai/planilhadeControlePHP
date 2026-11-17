import * as THREE from 'three';
import { PARTS, PAIRED } from '../entities/Human.js';

// Draws every pedestrian with one InstancedMesh per body part (~10 draw calls for the whole crowd).
// Each instance takes its matrix from the rig joint and its colour (skin, shirt...) via instanceColor.
const CROWD_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

export class CrowdRenderer {
  constructor(scene, maxPeople) {
    this.parts = {};
    this._c = new THREE.Color();
    for (const name of Object.keys(PARTS)) {
      const cap = maxPeople * (PAIRED.has(name) ? 2 : 1);
      const m = new THREE.InstancedMesh(PARTS[name], CROWD_MAT, cap);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      this.parts[name] = { m, n: 0, cap };
    }
  }
  begin() { for (const k in this.parts) this.parts[k].n = 0; }
  add(root) {
    root.updateMatrixWorld(true);
    for (const [name, node, hex] of root.userData.parts) {
      const e = this.parts[name];
      if (e.n >= e.cap) continue;
      e.m.setMatrixAt(e.n, node.matrixWorld);
      e.m.setColorAt(e.n, this._c.setHex(hex));
      e.n++;
    }
  }
  end() {
    for (const k in this.parts) {
      const e = this.parts[k];
      e.m.count = e.n;
      e.m.instanceMatrix.needsUpdate = true;
      e.m.instanceColor.needsUpdate = true;
    }
  }
}
