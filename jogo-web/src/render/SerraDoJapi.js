import * as THREE from 'three';

// RUNTIME (1 chamada de desenho, criada uma vez): silhueta da Serra do Japi no horizonte, a oeste/sudoeste.
// Fica "colada" ao céu (como o SkyDome): nunca é cortada pela distância e fica atrás da cidade.
// Aponta sempre para a posição real da serra e ganha o tom do horizonte (névoa, hora, chuva).
export const SERRA = { lon: -46.955, lat: -23.235 };

export class SerraDoJapi {
  constructor() {
    const pos = [], SEG = 90, SPAN = 1.5; // ~86° de horizonte
    const prof = (t) => {
      const edge = Math.sin(Math.PI * t); // afina nas pontas
      // exagerada ~2,3× (como nos jogos) para aparecer acima dos prédios distantes
      return (0.085 + 0.04 * Math.sin(t * 9.1) + 0.022 * Math.sin(t * 23.7 + 1.3) + 0.01 * Math.sin(t * 57.3)) * Math.pow(edge, 0.55);
    };
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG, t1 = (i + 1) / SEG, a0 = (t0 - 0.5) * SPAN, a1 = (t1 - 0.5) * SPAN;
      const p0 = [Math.sin(a0), Math.cos(a0)], p1 = [Math.sin(a1), Math.cos(a1)], y0 = prof(t0), y1 = prof(t1), yb = -0.05;
      pos.push(p0[0], yb, p0[1], p1[0], yb, p1[1], p0[0], y0, p0[1], p1[0], yb, p1[1], p1[0], y1, p1[1], p0[0], y0, p0[1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.material = new THREE.ShaderMaterial({
      depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0x2f4a2c) }, uTop: { value: new THREE.Color(0x4f6b44) } },
      vertexShader: 'varying float vY; void main(){ vY = position.y; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 uColor, uTop; varying float vY;
        float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        void main(){
          // copas da mata: textura de pontinhos + mais claro no alto
          float n = hh(floor(gl_FragCoord.xy / 3.0)) * 0.08;
          vec3 c = mix(uColor, uTop, clamp(vY / 0.12, 0.0, 1.0)) * (0.94 + n);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.scale.setScalar(900);
    this.mesh.renderOrder = -0.5; // depois do céu, antes da cidade
    this.mesh.frustumCulled = false;
  }
  // azimute da câmera até a serra (graus no plano x/z do jogo)
  follow(camera, serraXZ) {
    this.mesh.position.copy(camera.position);
    this.mesh.rotation.y = Math.atan2(serraXZ[0] - camera.position.x, serraXZ[1] - camera.position.z);
  }
  // mata atlântica vista de longe: verde-escuro puxado para a cor do horizonte (perspectiva atmosférica)
  tint(horizon, night) {
    this.material.uniforms.uColor.value.set(0x223d22).lerp(horizon, 0.28 + night * 0.3);
    this.material.uniforms.uTop.value.set(0x3e5c36).lerp(horizon, 0.36 + night * 0.3);
  }
}
