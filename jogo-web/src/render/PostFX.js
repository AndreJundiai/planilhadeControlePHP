import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Imagem final no estilo dos GTA modernos (IV/V): cores dessaturadas puxadas para o dourado/marrom nos claros
// e para o verde-acinzentado nas sombras, curva de contraste de filme com ombro suave, granulação de película,
// vinheta, bloom forte nas luzes e desfoque radial em alta velocidade. Tudo num passe só (barato).
// uIV = 0 volta ao visual quente "San Andreas" de antes.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHaze: { value: 0 }, uWarm: { value: 1 }, uIV: { value: 1 }, uSpeed: { value: 0 }, uGrain: { value: 1 }, uRes: { value: new THREE.Vector2(1280, 720) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uHaze, uWarm, uIV, uSpeed, uGrain; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      // ondulação de calor no horizonte em dia de sol
      float band = smoothstep(0.38, 0.52, uv.y) * (1.0 - smoothstep(0.52, 0.66, uv.y));
      uv.x += sin(uv.y * 140.0 + uTime * 3.2) * 0.0004 * band * uHaze; // sutil: forte demais entortava postes e vitrines
      // aberração cromática nas bordas
      vec2 d = (uv - 0.5) * 0.0035;
      vec3 c = vec3(texture2D(tDiffuse, uv + d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - d).b);
      // desfoque radial de velocidade (bordas borram, o centro fica nítido)
      if (uSpeed > 0.01) {
        vec2 dir = (uv - 0.5) * uSpeed * 0.035;
        vec3 acc = c;
        for (int i = 1; i <= 5; i++) acc += texture2D(tDiffuse, uv - dir * float(i)).rgb;
        c = mix(c, acc / 6.0, smoothstep(0.08, 0.45, length(uv - 0.5)));
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // visual antigo (San Andreas): sépia quente
      vec3 sa = mix(c, vec3(l * 1.07, l * 0.95, l * 0.78), 0.18 * uWarm) * mix(vec3(1.0), vec3(1.06, 1.0, 0.88), uWarm);
      sa = (sa - 0.5) * 1.06 + 0.5;
      // visual GTA IV: dessatura, claros dourados, sombras frias, curva de filme
      vec3 iv = mix(vec3(l), c, 0.66);
      iv *= vec3(1.07, 1.0, 0.84);
      iv = mix(iv, iv * vec3(0.86, 0.97, 1.02), (1.0 - smoothstep(0.0, 0.45, l)) * 0.55);
      iv = clamp(iv, 0.0, 1.0);
      iv = mix(iv, iv * iv * (3.0 - 2.0 * iv), 0.45);  // curva em S de filme: mais contraste nos meios-tons
      iv = pow(iv, vec3(1.1)) * 0.96 + 0.015;          // um pouco mais escuro e pretos levemente "lavados" (película)
      c = mix(sa, iv, uIV);
      // granulação de película (muda a cada quadro)
      c += (hash(uv * uRes + fract(uTime * 7.13) * 91.7) - 0.5) * 0.045 * uGrain * uIV;
      float v = smoothstep(mix(0.95, 0.85, uIV), 0.32, length(vUv - 0.5)); // vinheta
      gl_FragColor = vec4(c * mix(mix(0.78, 0.68, uIV), 1.0, v), 1.0);
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
  setQuality({ bloom, pixelRatio, ao, iv = 1, blur = false }) {
    this.bloom.enabled = bloom;
    // bloom "GTA IV": mais forte, mais largo e pegando mais luzes
    this.bloom.strength = iv ? 0.78 : 0.55; this.bloom.radius = iv ? 0.78 : 0.6; this.bloom.threshold = iv ? 0.72 : 0.82;
    this.grade.uniforms.uIV.value = iv;
    this.blur = blur;
    this.ao.enabled = !!ao;
    this.composer.setPixelRatio(pixelRatio);
  }
  setSize(w, h) { this.composer.setSize(w, h); this.grade.uniforms.uRes.value.set(w, h); }
  render(time, haze, speed = 0) {
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uHaze.value = haze;
    const sp = this.blur ? Math.min(1, Math.max(0, (Math.abs(speed) - 14) / 22)) : 0; // a partir de ~50 km/h
    this.grade.uniforms.uSpeed.value += (sp - this.grade.uniforms.uSpeed.value) * 0.1;
    this.composer.render();
  }
}
