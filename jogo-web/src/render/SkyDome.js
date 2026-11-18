import * as THREE from 'three';

// Cheap PS2-style sky: vertical gradient + soft sun glow. Follows the camera, ignores fog.
export class SkyDome {
  constructor(colors, sunDir) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: colors.skyTop },
        uHorizon: { value: colors.horizon },
        uSun: { value: colors.sun },
        uSunDir: { value: sunDir },
        uNight: { value: colors.night },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uTop, uHorizon, uSun, uSunDir; uniform float uNight; varying vec3 vDir;
        void main(){
          float y = max(vDir.y, 0.0);
          vec3 c = mix(uHorizon, uTop, pow(y, 0.55));
          float s = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          c += uSun * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.35) * (1.0 - uNight * 0.7); // sun disc + halo
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), this.material);
    this.mesh.scale.setScalar(1000);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }
  follow(camera) { this.mesh.position.copy(camera.position); }
}
