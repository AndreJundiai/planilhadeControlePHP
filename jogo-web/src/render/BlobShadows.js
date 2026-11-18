import * as THREE from 'three';

// Blob shadows: one InstancedMesh of soft dark ellipses under every character and car (1 draw call).
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,0.85)');
  r.addColorStop(0.6, 'rgba(0,0,0,0.45)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BlobShadows {
  constructor(scene, max = 160) {
    const mat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.max = max;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  /** Adds one ellipse: width (x) and length (z) in metres, rotated by heading. */
  add(x, z, width, length, heading) {
    if (this.n >= this.max) return;
    this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
    this.mesh.setMatrixAt(this.n++, this._m.compose(this._p.set(x, 0.1, z), this._q, this._s.set(width, 1, length)));
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
