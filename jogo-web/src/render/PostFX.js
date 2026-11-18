import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// PS2-era look: blown-out bloom on lights + warm amber grade, subtle chromatic aberration,
// vignette and an optional heat haze shimmer around the horizon on sunny days.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHaze: { value: 0 }, uWarm: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uHaze, uWarm; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      // heat haze: horizontal ripple, strongest in a band around the horizon (screen middle)
      float band = smoothstep(0.38, 0.52, uv.y) * (1.0 - smoothstep(0.52, 0.66, uv.y));
      uv.x += sin(uv.y * 140.0 + uTime * 3.2) * 0.0016 * band * uHaze;
      // chromatic aberration grows towards the screen edges
      vec2 d = (uv - 0.5) * 0.0035;
      vec3 c = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
      // warm sepia/amber grade
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 sepia = vec3(l * 1.07, l * 0.95, l * 0.78);
      c = mix(c, sepia, 0.18 * uWarm) * mix(vec3(1.0), vec3(1.06, 1.0, 0.88), uWarm);
      c = (c - 0.5) * 1.06 + 0.5; // a bit of contrast
      float v = smoothstep(0.95, 0.35, length(vUv - 0.5)); // vignette
      gl_FragColor = vec4(c * mix(0.78, 1.0, v), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // oclusão de ambiente (cantos e encontros de parede escurecem): só no nível Alto
    this.ao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    this.ao.blendIntensity = 0.85;
    this.ao.enabled = false;
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass()); // tone mapping + sRGB
    // grade runs AFTER the output conversion, in display space, so contrast doesn't crush dark linear values
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setQuality({ bloom, pixelRatio, ao }) {
    this.bloom.enabled = bloom;
    this.ao.enabled = !!ao;
    this.composer.setPixelRatio(pixelRatio);
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render(time, haze) {
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uHaze.value = haze;
    this.composer.render();
  }
}
