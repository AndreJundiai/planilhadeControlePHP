import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);

// HUD mínimo: objetivo, timer, vida, estrelas, velocímetro, telefone, balões e minimapa.
// Minimapa = MapLibre GL (tiles vetoriais OpenFreeMap) + canvas por cima com marcadores dinâmicos.
// Se os tiles não carregarem, o canvas desenha as ruas a partir do grafo do OSM.
export class HUD {
  constructor(proj) {
    this.proj = proj;
    this.cache = {};
    this.mm = $('mm-canvas').getContext('2d');
    this.mapOk = false;
    this.mpp = (156543.03392 * Math.cos((proj.lat0 * Math.PI) / 180)) / 2 ** 16; // metros por pixel CSS no zoom 16
    try {
      this.map = new maplibregl.Map({
        container: 'mm-map', style: CONFIG.minimapStyle, center: proj.toLonLat(0, 0), zoom: 16,
        interactive: false, attributionControl: false, fadeDuration: 0,
      });
      this.map.on('load', () => { this.mapOk = true; });
      this.map.on('error', () => {});
    } catch { this.map = null; }
    this.bubbleEls = Array.from({ length: 8 }, () => $('bubbles').appendChild(document.createElement('div')));
    this.toastT = 0;
    this.callT = 0;
  }

  _set(id, prop, val) {
    const k = id + prop;
    if (this.cache[k] === val) return;
    this.cache[k] = val;
    const el = $(id);
    if (prop === 'html') el.innerHTML = val; else if (prop === 'text') el.textContent = val; else el.style[prop] = val;
  }

  toast(text, color = '#fff') {
    const t = $('toast');
    t.textContent = text;
    t.style.color = color;
    t.style.opacity = 1;
    this.toastT = 3.2;
  }

  call(from, text) {
    $('call').querySelector('.from').textContent = from;
    $('call').querySelector('.text').textContent = text;
    $('call').classList.add('show');
    this.callT = 7;
  }

  update(dt, s) {
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('toast').style.opacity = 0;
    if (this.callT > 0 && (this.callT -= dt) <= 0) $('call').classList.remove('show');
    this._set('mission-title', 'text', s.title);
    this._set('objective', 'text', s.objective);
    this._set('timer', 'text', s.timer != null ? `${Math.floor(s.timer / 60)}:${String(Math.floor(s.timer % 60)).padStart(2, '0')}` : '');
    this._set('stars', 'html', [1, 2, 3].map((i) => `<span class="${i <= s.stars ? 'on' : 'off'}">★</span>`).join(''));
    this._set('health-bar', 'width', `${Math.max(0, s.health)}%`);
    this._set('briefcase', 'display', s.briefcase ? 'block' : 'none');
    this._set('groceries', 'display', s.groceries ? 'block' : 'none');
    this._set('money', 'text', `R$ ${(s.money ?? 0).toFixed(2).replace('.', ',')}`);
    this._set('speed', 'html', s.speed != null ? `${s.speed}<small> km/h</small>` : '');
    this._set('street', 'text', s.street);
    this._set('clock', 'text', s.clock || '');
    this._set('job', 'text', s.job || '');
    this._set('job', 'display', s.job ? 'block' : 'none');
    this._set('perf', 'text', s.perf || '');
    this._set('prompt', 'text', s.prompt);
    this._set('prompt', 'display', s.prompt ? 'block' : 'none');
  }

  bubbles(list, camera) {
    const v = this._v || (this._v = camera.position.clone());
    const near = list
      .map((b) => ({ ...b, d: Math.hypot(b.x - camera.position.x, b.z - camera.position.z) }))
      .filter((b) => b.d < 35).sort((a, b) => a.d - b.d);
    this.bubbleEls.forEach((el, i) => {
      const b = near[i];
      if (b) {
        v.set(b.x, b.y, b.z).project(camera);
        if (v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1) {
          el.style.display = 'block';
          el.style.left = `${((v.x + 1) / 2) * innerWidth}px`;
          el.style.top = `${((1 - v.y) / 2) * innerHeight}px`;
          el.textContent = b.text;
          return;
        }
      }
      el.style.display = 'none';
    });
  }

  // yaw da câmera define a rotação; markers: [{x,z,color,r,edge}]
  minimap(px, pz, yaw, heading, markers, graph) {
    const c = this.mm, W = 440, C = W / 2, k = 2 / this.mpp;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const tr = (x, z) => { const dx = x - px, dz = z - pz; return [C + (dx * rx + dz * rz) * k, C - (dx * fx + dz * fz) * k]; };
    const bearing = (-yaw * 180) / Math.PI;
    if (this.map && this.mapOk) this.map.jumpTo({ center: this.proj.toLonLat(px, pz), bearing });
    c.clearRect(0, 0, W, W);
    if (!this.mapOk) {
      c.fillStyle = '#1d2a1f';
      c.fillRect(0, 0, W, W);
      c.strokeStyle = '#5d6470';
      c.lineWidth = 7;
      c.beginPath();
      for (const n of graph.nodesNear(px, pz, 300)) {
        for (const e of n.edges) {
          if (String(e.to) < String(n.id)) continue;
          const m = graph.get(e.to), a = tr(n.x, n.z), b = tr(m.x, m.z);
          c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        }
      }
      c.stroke();
    }
    for (const m of markers) {
      let [x, y] = tr(m.x, m.z);
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy), R = C - 14;
      if (d > R) { if (!m.edge) continue; x = C + (dx / d) * R; y = C + (dy / d) * R; }
      c.beginPath();
      c.arc(x, y, m.r || 7, 0, Math.PI * 2);
      c.fillStyle = m.color;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#000a';
      c.stroke();
    }
    const comp = Math.atan2(Math.sin(heading), -Math.cos(heading)) * (180 / Math.PI);
    this._set('mm-player', 'transform', `rotate(${(comp - bearing).toFixed(1)}deg)`);
  }
}
