import * as THREE from 'three';
import { sampleTimecyc, sunDirection } from '../render/Timecyc.js';
import { uniforms } from '../map/WorldBuilder.js';
import { setFurnitureNight } from '../map/StreetFurniture.js';
import { setWetRoad, setCarLightsNight } from '../player/Vehicle.js';

/**
 * Relógio do Jundiaí Vivo: 1 dia de jogo = 24 minutos reais. A cada meio segundo a luz, o céu,
 * a névoa, os postes e as janelas acompanham a hora. O clima muda sozinho: períodos de chuva
 * escurecem o céu, molham o asfalto (poças) e deixam o carro escorregadio.
 */
export const DAY_MINUTES = 24;
const RAIN_SKY = new THREE.Color(0x5d6670), RAIN_FOG = new THREE.Color(0x7a828c);

export class Clock {
  constructor(g, hour = 7, day = 1) {
    this.g = g;
    this.hour = hour;
    this.day = day;
    this.rain = 0;
    this.rainTarget = 0;
    this.weatherT = 90;
    this._t = 0;
    this.apply();
  }

  get label() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  get night() { return this.hour < 6 || this.hour >= 19; }

  update(dt) {
    this.hour += (dt * 24) / (DAY_MINUTES * 60);
    if (this.hour >= 24) { this.hour -= 24; this.day++; this.g.onNewDay?.(this.day); }
    // clima: a cada 2–5 minutos decide se vai chover
    if ((this.weatherT -= dt) <= 0) {
      this.weatherT = 120 + Math.random() * 180;
      this.rainTarget = Math.random() < 0.28 ? 0.55 + Math.random() * 0.45 : 0;
      if (this.rainTarget > 0 && this.rain < 0.1) this.g.hud.toast('🌧 Vai chover em Jundiaí...', '#9fc3ff');
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.08);
    if ((this._t -= dt) <= 0) { this._t = 0.5; this.apply(); }
  }

  // dorme até a próxima manhã (7h)
  skipTo(hour) {
    if (hour <= this.hour) this.day++;
    this.hour = hour;
    this.rain = this.rainTarget = 0;
    this.apply();
  }

  apply() {
    const g = this.g, tc = sampleTimecyc(this.hour), r = this.rain;
    tc.horizon.lerp(RAIN_FOG, r * 0.75);
    tc.skyTop.lerp(RAIN_SKY, r * 0.8);
    const sunI = tc.sunIntensity * (1 - 0.65 * r), ambI = tc.ambIntensity * (1 - 0.2 * r);
    g.scene.background.copy(tc.horizon);
    g.serra?.tint(tc.horizon, tc.night);
    g.scene.fog.color.copy(tc.horizon);
    const far = g.quality?.p.far ?? 420;
    g.scene.fog.density = 2 / (far * (1 - 0.4 * r)); // neblina exponencial: chuva fecha o horizonte
    if (g.hemi) { g.hemi.color.copy(tc.ambSky); g.hemi.groundColor.copy(tc.ambGround); g.hemi.intensity = ambI; }
    g.sun.color.copy(tc.sun);
    g.sun.intensity = sunI;
    g.sunDir.copy(sunDirection(this.hour));
    const u = g.skyDome.material.uniforms;
    u.uTop.value.copy(tc.skyTop);
    u.uHorizon.value.copy(tc.horizon);
    u.uSun.value.copy(tc.sun).multiplyScalar(1 - 0.8 * r);
    u.uSunDir.value.copy(g.sunDir);
    u.uNight.value = tc.night;
    uniforms.uNight.value = tc.night;
    uniforms.uSky.value.copy(tc.horizon).lerp(tc.skyTop, 0.35);
    uniforms.uWet.value = 0.3 + r * 0.7;
    setFurnitureNight(tc.night > 0.5);
    setCarLightsNight(tc.night);     // faróis, lanternas e feixes de luz
    g.landmarks?.setNight(tc.night); // letreiros dos mercados (Tauste 24 h brilha mais)
    g.domModel?.setNight(tc.night);   // letreiro e vitrine do Dom Olívio
    setWetRoad(r);
    g.hour = this.hour;
    g.night = this.night;
    g.haze = !g.night && this.hour >= 10 && this.hour <= 16 && r < 0.1 ? 1 : 0;
  }
}

/** Gotas de chuva: linhas caindo numa caixa que acompanha a câmera (1 chamada de desenho). */
export class RainFX {
  constructor(scene, count) {
    this.n = count;
    const pos = new Float32Array(count * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.drops = Array.from({ length: count }, () => [Math.random() * 40 - 20, Math.random() * 24, Math.random() * 40 - 20]);
    this.mat = new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.LineSegments(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(dt, cam, rain) {
    this.mesh.visible = rain > 0.04;
    if (!this.mesh.visible) return;
    this.mat.opacity = Math.min(0.55, rain * 0.6);
    const a = this.geo.attributes.position.array, shown = Math.floor(this.n * Math.min(1, rain * 1.2));
    for (let i = 0; i < this.n; i++) {
      const d = this.drops[i];
      d[1] -= dt * 24;
      if (d[1] < 0) { d[1] += 24; d[0] = Math.random() * 40 - 20; d[2] = Math.random() * 40 - 20; }
      const x = cam.position.x + d[0], y = (i < shown ? cam.position.y - 8 + d[1] : -999), z = cam.position.z + d[2];
      a[i * 6] = x; a[i * 6 + 1] = y; a[i * 6 + 2] = z;
      a[i * 6 + 3] = x + 0.05; a[i * 6 + 4] = y + 0.7; a[i * 6 + 5] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}
