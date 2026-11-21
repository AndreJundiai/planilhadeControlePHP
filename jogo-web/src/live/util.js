import * as THREE from 'three';

// Peças visuais reaproveitadas pelos sistemas do Jundiaí Vivo.
export function makeBeacon(scene, color) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 18, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false;
  scene.add(m);
  return { mesh: m, at(x, z) { m.visible = true; m.position.set(x, 35, z); }, hide() { m.visible = false; } };
}

export function makeSign(text, bg = '#c0392b', fg = '#fff', w = 4) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#ffd400'; g.fillRect(0, 110, 512, 18);
  g.fillStyle = fg; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase().slice(0, 18), 256, 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: true }));
  s.scale.set(w, w / 4, 1);
  return s;
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const brl = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');
