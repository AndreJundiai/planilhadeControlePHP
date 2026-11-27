import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeHuman, animateHuman, randomLook } from '../entities/Human.js';
import { Vehicle } from '../player/Vehicle.js';
import { parkingTexture } from '../render/ProceduralTextures.js';

/**
 * EMPÓRIO DOM OLÍVIO — Rua do Retiro, Jundiaí (modelado a partir das fotos do lugar).
 *
 * Exterior: caixa grande e baixa de painéis cinza-claros com juntas diagonais em "V", teto branco plano,
 * marquise vermelha correndo por duas fachadas com vitrine de vidro embaixo, letreiro "EMPÓRIO / DOM / olivio"
 * (azul com selo vermelho) nas duas fachadas, jardim vertical verde na quina, sebe sobre muro de pedra
 * junto à calçada, estacionamentos dos dois lados com palmeiras e carros parados.
 * Interior (dá para entrar pela porta automática): piso de cerâmica, luminárias, gôndolas cheias de
 * produtos, hortifruti, padaria, açougue, geladeiras de bebidas, 6 caixas com operadoras e clientes
 * andando com carrinho pelos corredores.
 *
 * Coordenadas locais: x ao longo da rua, +z aponta para a rua; a fachada da frente fica em z = 0 e o
 * prédio ocupa z ∈ [−D, 0]. Tudo é desenhado em poucas malhas (por material) e os produtos são instâncias.
 */
export const DOM = { W: 80, D: 50, H: 12, IH: 7.2, LOT: 30, SET: 16 }; // largura, fundo, altura, pé-direito, estacionamento, recuo da rua
const RED = 0xd3202a, BLUE = 0x2b3f8f;

// ---------------------------------------------------------------- texturas (Canvas 2D)
function cv(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// painéis de concreto claro com juntas horizontais e as diagonais em "V" da fachada
const facadeTex = () => cv(512, 256, (g, w, h) => {
  g.fillStyle = '#d9d7d2'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { const v = 200 + Math.random() * 30; g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = 'rgba(120,118,112,0.75)'; g.lineWidth = 2;
  for (let y = 0; y < h; y += h / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let x = 0; x < w; x += w / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.lineWidth = 5; g.strokeStyle = 'rgba(150,148,142,0.9)';
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w / 2, h); g.lineTo(w, 0); g.stroke(); // o "V"
});
// jardim vertical: folhagem verde e amarelada
const leafTex = () => cv(256, 256, (g, w, h) => {
  g.fillStyle = '#3d5d22'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) {
    const r = Math.random(), col = r < 0.35 ? '#b9c25a' : r < 0.7 ? '#6e8f2c' : '#2f4d1b';
    g.fillStyle = col; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 3 + Math.random() * 5, 1.5 + Math.random() * 3, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
});
const stoneTex = () => cv(256, 128, (g, w, h) => {
  g.fillStyle = '#6a5a48'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let x = (r % 2) * -20; x < w; x += 44) {
    const v = Math.random() * 40; g.fillStyle = `rgb(${120 + v},${100 + v},${78 + v})`; g.fillRect(x + 2, r * 32 + 2, 40, 28);
  }
});
const hedgeTex = () => cv(256, 128, (g, w, h) => {
  g.fillStyle = '#2f5420'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) { const v = Math.random(); g.fillStyle = `rgb(${40 + v * 50},${80 + v * 60},${30 + v * 20})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 2); }
});
const floorTex = () => cv(256, 256, (g, w, h) => {
  g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#bdb6aa'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
  for (let i = 0; i < 900; i++) { const v = 210 + Math.random() * 30; g.fillStyle = `rgba(${v},${v - 3},${v - 8},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
});
// teto com luminárias (emissivo)
const ceilTex = () => cv(256, 256, (g, w, h) => {
  g.fillStyle = '#4a4c50'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fffaf0'; for (const x of [40, 160]) g.fillRect(x, 20, 56, 216);
});
// letreiro: selo vermelho "EMPÓRIO", "DOM" azul grande e "olivio" embaixo (fundo transparente)
const logoTex = () => cv(1024, 512, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#d3202a'; g.fillRect(120, 30, 300, 80);
  g.fillStyle = '#fff'; g.font = '900 56px Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('EMPÓRIO', 140, 72);
  g.fillStyle = '#2b3f8f'; g.font = 'italic 900 300px "Arial Black", Arial, sans-serif'; g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowOffsetY = 6; g.fillText('DOM', 90, 380);
  g.shadowColor = 'transparent';
  g.font = '700 110px Georgia, serif'; g.fillText('olivio', 360, 490);
});
// frente de prateleira cheia de embalagens (caixas, garrafas, latas) — 3 variações para os corredores
const shelfTex = (seed) => cv(512, 128, (g, w, h) => {
  g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, w, h);
  const pal = [['#d94b4b', '#f0b429', '#2e8b57', '#3f7fd6', '#ffffff', '#e57aa1', '#ff7a00'], ['#1e9e9e', '#6b4fa3', '#ffffff', '#3f7fd6', '#9bd14b', '#f2f2f2'], ['#8a1c1c', '#3a5a2a', '#d4a017', '#5b2d8e', '#c0c0c0', '#1d3f8f']][seed % 3];
  let x = 0, k = seed * 7;
  while (x < w) {
    const bw = 14 + ((k * 13) % 22), bh = 60 + ((k * 29) % 62), c = pal[k % pal.length];
    g.fillStyle = c; g.fillRect(x + 1, h - bh, bw - 2, bh);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(x + 3, h - bh * 0.62, bw - 6, bh * 0.18); // rótulo
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + bw - 4, h - bh, 3, bh); // sombra lateral
    x += bw; k++;
  }
});
const signTex = (text, bg = '#d3202a') => cv(512, 128, (g, w, h) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '900 64px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
});

// ---------------------------------------------------------------- geometria
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const plane = (w, h, x, y, z, ry = 0, rx = 0) => new THREE.PlaneGeometry(w, h).rotateX(rx).rotateY(ry).translate(x, y, z);
// UV em metros (textura repetindo pelo tamanho real)
function meterUV(g, scale = 1) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u / scale, v / scale);
  }
  return g;
}

export class DomOlivio {
  /**
   * @param game   o jogo (cena, física, grafo)
   * @param origin { x, z, h } — centro da fachada da frente no mundo e o giro (local +z = para a rua)
   */
  constructor(game, origin) {
    this.g = game;
    this.o = origin;
    this.c = Math.cos(origin.h); this.s = Math.sin(origin.h);
    this.group = new THREE.Group();
    this.group.position.set(origin.x, 0, origin.z);
    this.group.rotation.y = origin.h;
    this.inside = new THREE.Group(); // interior: só desenha perto
    this.group.add(this.inside);
    this.colliders = []; // caixas (local) que viram colisão
    this.glassMats = [];
    this._exterior();
    this._lots();
    this._interior();
    this._people();
    this._physics();
    game.scene.add(this.group);
  }

  /** Ponto local → mundo. */
  W(lx, lz) { return { x: this.o.x + lx * this.c + lz * this.s, z: this.o.z - lx * this.s + lz * this.c }; }
  /** Retângulo (mundo) que o Dom ocupa com os estacionamentos: os prédios genéricos do mapa saem daí. */
  static footprint(o) { const { W, D, LOT } = DOM; return { cx: o.x - (D / 2 - 4) * Math.sin(o.h), cz: o.z - (D / 2 - 4) * Math.cos(o.h), c: Math.cos(o.h), s: Math.sin(o.h), hw: W / 2 + LOT + 2, hd: D / 2 + 8 }; }

  _add(geos, mat, { cast = true, receive = true, parent = this.group } = {}) {
    const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    m.castShadow = cast; m.receiveShadow = receive;
    parent.add(m);
    return m;
  }

  _exterior() {
    const { W, D, H } = DOM, T = 0.3, DOOR = 7, AW = 4; // espessura da parede, porta, avanço da marquise
    const facade = new THREE.MeshLambertMaterial({ map: facadeTex() });
    facade.map.wrapS = facade.map.wrapT = THREE.RepeatWrapping;
    // paredes externas (frente com o vão da porta e da vitrine até 3,3 m de altura)
    const walls = [
      box(W, H - 3.4, T, 0, 3.4 + (H - 3.4) / 2, -T / 2), // frente, acima da vitrine
      box(T, H, D, -W / 2 + T / 2, H / 2, -D / 2), box(T, H, D, W / 2 - T / 2, H / 2, -D / 2), box(W, H, T, 0, H / 2, -D + T / 2),
      box(12, 3.4, T, -W / 2 + 6, 1.7, -T / 2), // trecho cego da frente atrás do jardim vertical
    ];
    const fm = this._add(walls.map((g) => meterUV(g, 10)), facade);
    fm.material.map.repeat.set(1, 1);
    // platibanda e cantoneiras brancas no topo
    this._add([box(W + 0.6, 0.6, 0.6, 0, H + 0.1, 0), box(0.6, 0.6, D, -W / 2, H + 0.1, -D / 2), box(0.6, 0.6, D, W / 2, H + 0.1, -D / 2), box(W, 0.6, 0.6, 0, H + 0.1, -D)], new THREE.MeshLambertMaterial({ color: 0xf2f2ee }));
    this._add([box(W, 0.2, D, 0, H - 0.1, -D / 2)], new THREE.MeshLambertMaterial({ color: 0xe9e9e4 })); // teto branco plano
    // marquise vermelha: frente inteira + lateral esquerda (como na foto), com colunas finas
    const awn = [box(W - 12, 0.55, AW, 6, 3.55, AW / 2), box(AW, 0.55, D * 0.8, -W / 2 - AW / 2, 3.55, -D * 0.4)];
    const cols = [];
    for (let x = -W / 2 + 14; x <= W / 2 - 2; x += 8) cols.push(box(0.18, 3.3, 0.18, x, 1.65, AW - 0.3));
    for (let z = -4; z >= -D * 0.8; z -= 8) cols.push(box(0.18, 3.3, 0.18, -W / 2 - AW + 0.3, 1.65, z));
    this._add(awn, new THREE.MeshLambertMaterial({ color: RED }));
    this._add(cols, new THREE.MeshLambertMaterial({ color: 0xdedede }));
    // vitrine de vidro (com montantes) dos dois lados da porta + porta automática
    const glass = new THREE.MeshPhongMaterial({ color: 0x24323c, specular: 0x99aabb, shininess: 90, emissive: 0xfff2d8, emissiveIntensity: 0.18, transparent: true, opacity: 0.55 });
    this.glassMats.push(glass);
    const gx0 = -W / 2 + 12, half = (W / 2 - gx0) / 2;
    const left = (0 - DOOR / 2) - gx0, right = W / 2 - DOOR / 2;
    this._add([plane(left, 3.3, gx0 + left / 2, 1.65, -0.05), plane(right, 3.3, DOOR / 2 + right / 2, 1.65, -0.05)], glass, { cast: false });
    const mull = [];
    for (let x = gx0; x <= W / 2; x += 2.5) if (Math.abs(x) > DOOR / 2) mull.push(box(0.07, 3.3, 0.1, x, 1.65, -0.05));
    mull.push(box(W - 12, 0.1, 0.12, 6, 3.32, -0.05));
    this._add(mull, new THREE.MeshLambertMaterial({ color: 0x2a2d31 }));
    this.doorL = new THREE.Mesh(new THREE.BoxGeometry(DOOR / 2, 3.0, 0.06), glass); this.doorL.position.set(-DOOR / 4, 1.5, -0.1);
    this.doorR = this.doorL.clone(); this.doorR.position.x = DOOR / 4;
    this.group.add(this.doorL, this.doorR);
    void half;
    // jardim vertical na quina (frente e lateral)
    const leaf = new THREE.MeshLambertMaterial({ map: leafTex() });
    leaf.map.wrapS = leaf.map.wrapT = THREE.RepeatWrapping;
    this._add([meterUV(box(10, H - 0.6, 0.25, -W / 2 + 5.2, (H - 0.6) / 2, 0.15), 3), meterUV(box(0.25, H - 0.6, 7, -W / 2 - 0.15, (H - 0.6) / 2, -3.6), 3)], leaf);
    // letreiro nas duas fachadas (acende à noite)
    const logo = new THREE.MeshLambertMaterial({ map: logoTex(), transparent: true, emissive: 0xffffff, emissiveMap: null, alphaTest: 0.05 });
    logo.emissiveMap = logo.map; logo.emissiveIntensity = 0.12;
    this.logoMat = logo;
    this._add([plane(14, 7, -W / 2 + 22, 7.6, 0.06), plane(14, 7, -W / 2 - 0.06, 7.6, -D * 0.45, -Math.PI / 2)], logo, { cast: false });
    // sebe sobre muro de pedra junto à calçada (com o caminho da entrada aberto)
    const stone = new THREE.MeshLambertMaterial({ map: stoneTex() }); stone.map.wrapS = stone.map.wrapT = THREE.RepeatWrapping;
    const hedge = new THREE.MeshLambertMaterial({ map: hedgeTex() }); hedge.map.wrapS = hedge.map.wrapT = THREE.RepeatWrapping;
    const segs = [[-W / 2, -4], [4, W / 2]], z0 = DOM.SET - 8.5;
    this._add(segs.map(([a, b]) => meterUV(box(b - a, 0.9, 1.6, (a + b) / 2, 0.45, z0), 2)), stone);
    this._add(segs.map(([a, b]) => meterUV(box(b - a, 1.1, 1.3, (a + b) / 2, 1.45, z0), 2)), hedge);
    for (const [a, b] of segs) this.colliders.push([(a + b) / 2, z0, (b - a) / 2, 0.8]);
    // calçada interna (piso de concreto) do muro até a fachada
    this._add([box(W + 8, 0.1, z0 - 0.8, 0, 0.05, (z0 - 0.8) / 2)], new THREE.MeshLambertMaterial({ color: 0xb8b4ab }), { cast: false });
    // paredes como colisão (frente com o vão da porta)
    const t = T / 2;
    this.colliders.push([-W / 2 + t, -D / 2, t, D / 2], [W / 2 - t, -D / 2, t, D / 2], [0, -D + t, W / 2, t]);
    this.colliders.push([(-W / 2 + -DOOR / 2) / 2, -t, (W / 2 - DOOR / 2) / 2, t], [(W / 2 + DOOR / 2) / 2, -t, (W / 2 - DOOR / 2) / 2, t]);
  }

  // estacionamentos laterais com vagas, palmeiras e carros parados
  _lots() {
    const { W, D, LOT } = DOM;
    const lotMat = new THREE.MeshLambertMaterial({ map: parkingTexture().clone() });
    lotMat.map.wrapS = lotMat.map.wrapT = THREE.RepeatWrapping; lotMat.map.repeat.set(1 / 10, 1 / 10); lotMat.map.needsUpdate = true;
    const lots = [[-W / 2 - LOT / 2 - 4, LOT], [W / 2 + LOT / 2, LOT]];
    this._add(lots.map(([x, w]) => { const g = box(w, 0.08, D + 6, x, 0.04, -D / 2 + 3); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i)); return g; }), lotMat, { cast: false });
    // palmeiras (tronco + folhas) numa malha instanciada
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 7, 7).translate(0, 3.5, 0);
    const frond = [];
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; frond.push(new THREE.PlaneGeometry(0.8, 3.4).translate(0, 1.7, 0).rotateX(1.15).rotateY(a).translate(0, 7, 0)); }
    const spots = [];
    for (const x of [-W / 2 - 6, -W / 2 - LOT, W / 2 + 4, W / 2 + LOT - 2]) for (const z of [2, -14, -30]) spots.push([x, z]);
    const tm = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x8a7a60 }), spots.length);
    const fm = new THREE.InstancedMesh(mergeGeometries(frond), new THREE.MeshLambertMaterial({ color: 0x4f8a35, side: THREE.DoubleSide }), spots.length);
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, z], i) => { m4.makeRotationY(i * 1.7).setPosition(x, 0, z); tm.setMatrixAt(i, m4); fm.setMatrixAt(i, m4); });
    tm.castShadow = fm.castShadow = true;
    this.group.add(tm, fm);
    // carros estacionados (decoração)
    const colors = [0xe8e8e8, 0x1f1f1f, 0x9aa0a6, 0x8a1c1c, 0xd9d9d9, 0x2b3f6a, 0xb5b5b5, 0x3a3a3a];
    let k = 0;
    for (const [x0] of lots) for (let z = -6; z > -D + 4; z -= 7.5) {
      if (k % 2 === 0 || k % 7 === 3) { k++; continue; } // vaga vazia (metade fica livre: menos triângulos)
      const v = new Vehicle(colors[k % colors.length], false, ['sedan', 'hatch', 'suv'][k % 3]);
      v.mesh.position.set(x0 + (k % 2 ? 6 : -6), 0, z);
      v.mesh.rotation.y = k % 2 ? Math.PI / 2 : -Math.PI / 2;
      this.group.add(v.mesh);
      this.colliders.push([v.mesh.position.x, z, 2.3, 1]);
      k++;
    }
  }

  _interior() {
    const { W, D, IH } = DOM, G = this.inside;
    // materiais com "luz própria": a loja é iluminada por dentro (sem luzes extras na cena)
    const lit = (o) => new THREE.MeshLambertMaterial({ emissive: 0xfff4e0, emissiveIntensity: 0.1, ...o });
    const floor = lit({ map: floorTex() }); floor.map.wrapS = floor.map.wrapT = THREE.RepeatWrapping; floor.map.repeat.set(W / 4, D / 4);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, D - 0.6).rotateX(-Math.PI / 2).translate(0, 0.11, -D / 2), floor); // piso um pouco acima das ruas do mapa
    fl.receiveShadow = true; G.add(fl);
    const ceil = new THREE.MeshLambertMaterial({ map: ceilTex(), emissive: 0xffffff, emissiveMap: null });
    ceil.emissiveMap = ceil.map; ceil.emissiveIntensity = 0.55; ceil.map.wrapS = ceil.map.wrapT = THREE.RepeatWrapping; ceil.map.repeat.set(W / 6, D / 6);
    G.add(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, D - 0.6).rotateX(Math.PI / 2).translate(0, IH, -D / 2), ceil));
    // paredes internas claras (cobrem por dentro até o teto rebaixado)
    this._add([box(W - 0.7, IH, 0.05, 0, IH / 2, -D + 0.36), box(0.05, IH, D - 0.7, -W / 2 + 0.36, IH / 2, -D / 2), box(0.05, IH, D - 0.7, W / 2 - 0.36, IH / 2, -D / 2), box(W - 0.7, IH - 3.4, 0.05, 0, 3.4 + (IH - 3.4) / 2, -0.36)],
      lit({ color: 0xefe9dc }), { parent: G, cast: false });
    // gôndolas (estantes) com produtos
    const shelfGeo = [], prod = [], rows = [[], [], []], gx0 = -18, gx1 = 30, z0 = -16, z1 = -40, L = z0 - z1;
    for (let x = gx0; x <= gx1; x += 4.2) {
      shelfGeo.push(box(0.22, 1.95, L, x, 0.98, (z0 + z1) / 2)); // painel central da gôndola
      for (const side of [-1, 1]) for (let lv = 0; lv < 4; lv++) shelfGeo.push(box(0.5, 0.04, L, x + side * 0.36, 0.08 + lv * 0.45, (z0 + z1) / 2)); // prateleiras
      this.colliders.push([x, (z0 + z1) / 2, 0.6, L / 2]);
      // produtos: uma faixa por prateleira com textura de embalagens (antes ~6 mil caixinhas = 72 mil triângulos)
      for (const side of [-1, 1]) for (let lv = 0; lv < 4; lv++) {
        const gm = box(0.34, 0.36, L - 0.2, x + side * 0.38, 0.27 + lv * 0.45, (z0 + z1) / 2), pp = gm.attributes.position, uv = gm.attributes.uv;
        for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getZ(i) / 3.2, (pp.getY(i) - (0.09 + lv * 0.45)) / 0.36);
        rows[(((Math.round(x * 3) + lv + (side > 0 ? 1 : 0)) % 3) + 3) % 3].push(gm); // x negativo: módulo positivo
      }
    }
    // padaria (fundo, esquerda), açougue (fundo, direita), geladeiras de bebidas (fundo)
    const counters = [box(16, 1.1, 1.2, -26, 0.55, -44), box(16, 1.1, 1.2, 14, 0.55, -46)];
    this.colliders.push([-26, -44, 8, 0.6], [14, -46, 8, 0.6]);
    this._add(shelfGeo.concat(counters), lit({ color: 0xf4f4f2 }), { parent: G });
    rows.forEach((geos, i) => { if (!geos.length) return; const t = shelfTex(i); t.wrapS = THREE.RepeatWrapping; this._add(geos, new THREE.MeshLambertMaterial({ map: t }), { parent: G, cast: false }); });
    const fridge = new THREE.MeshPhongMaterial({ color: 0x0d1a24, emissive: 0xd8f0ff, emissiveIntensity: 0.35, specular: 0xffffff, shininess: 80 });
    this._add([box(30, 2.4, 0.9, 30 - 15 + 4, 1.2, -D + 1.1)], fridge, { parent: G, cast: false });
    this.colliders.push([19, -D + 1.1, 15, 0.45]);
    // hortifruti (frente, esquerda): bancas inclinadas com frutas e verduras
    const bins = [];
    for (let x = -34; x <= -22; x += 4) for (const z of [-10, -16]) { bins.push(box(3.2, 0.9, 2.2, x, 0.45, z)); this.colliders.push([x, z, 1.6, 1.1]); for (let i = 0; i < 60; i++) prod.push([x + (Math.random() - 0.5) * 2.8, 1.0 + Math.random() * 0.12, z + (Math.random() - 0.5) * 1.8, 4]); }
    this._add(bins, lit({ color: 0x8a6440 }), { parent: G });
    // caixas (6) perto da entrada, à direita
    const chk = [];
    this.checkouts = [];
    for (let i = 0; i < 6; i++) {
      const x = 8 + i * 4.2, z = -7;
      chk.push(box(0.9, 0.95, 3.4, x, 0.48, z), box(0.5, 0.35, 0.4, x, 1.12, z - 1.1), box(0.06, 1.0, 0.06, x + 0.3, 1.5, z - 1.4));
      this.colliders.push([x, z, 0.45, 1.7]);
      this.checkouts.push({ x: x + 1.0, z: z - 0.9 }); // onde a operadora fica
    }
    this._add(chk, lit({ color: 0x3a3d42 }), { parent: G });
    const belts = this.checkouts.map((c) => box(0.6, 0.04, 2.2, c.x - 1.0, 0.97, -6.4));
    this._add(belts, lit({ color: 0x111111 }), { parent: G, cast: false });
    // produtos: UMA malha instanciada com cores de embalagem
    const pal = [0xd94b4b, 0xf0b429, 0x2e8b57, 0x3f7fd6, 0xffffff, 0xe57aa1, 0x8a6f4d, 0xff7a00, 0x6b4fa3, 0x1e9e9e];
    const fruit = [0xe23b2b, 0xffb020, 0x5aa02c, 0xf6e04d, 0x8c3a6b];
    const pm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshLambertMaterial({ flatShading: true }), prod.length); // frutas e verduras
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
    prod.forEach(([x, y, z, lv], i) => {
      const f = lv === 4, k = 0.7 + Math.random() * 0.5;
      pm.setMatrixAt(i, m4.compose(v.set(x, y, z), q, f ? sc.set(0.45, 0.45, 0.45) : sc.set(0.9, k, 1)));
      pm.setColorAt(i, col.setHex(f ? fruit[i % fruit.length] : pal[(i * 7 + Math.floor(z * 3)) % pal.length]));
    });
    pm.castShadow = false;
    this.products = pm;
    G.add(pm);
    // placas penduradas das seções
    const hang = (text, x, z, w = 6, bg) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTex(text, bg), side: THREE.DoubleSide })); m.position.set(x, IH - 1.6, z); G.add(m); };
    hang('HORTIFRUTI', -28, -13, 7, '#2e8b57'); hang('PADARIA', -26, -41); hang('AÇOUGUE', 14, -43);
    hang('BEBIDAS', 19, -D + 3, 6, '#2b3f8f'); hang('MERCEARIA', 6, -28, 7, '#2b3f8f'); hang('CAIXAS', 18, -3.5, 6);
    this.counter = this.checkouts[0]; // primeiro caixa: onde o André paga (missão 1)
  }

  // funcionários (uniforme vermelho do Dom) e clientes com carrinho pelos corredores
  _people() {
    this.staff = [];
    this.shoppers = [];
    const uniform = (i) => ({ ...randomLook(100 + i), shirt: 0xffffff, vest: RED, pants: 0x1d2433, hat: null, backpack: null, bag: null });
    for (const [i, c] of this.checkouts.entries()) this.staff.push(this._person(uniform(i), c.x, c.z, -Math.PI / 2));
    this.staff.push(this._person(uniform(7), -26, -45.2, 0), this._person(uniform(8), 14, -47.2, 0), this._person(uniform(9), -20, -12, Math.PI / 2)); // padeiro, açougueiro, repositor
    const cartGeo = mergeGeometries([box(0.6, 0.5, 0.9, 0, 0.7, 0), box(0.6, 0.05, 0.05, 0, 1.05, -0.5), ...[[-0.25, 0.35], [0.25, 0.35], [-0.25, -0.35], [0.25, -0.35]].map(([x, z]) => box(0.06, 0.45, 0.06, x, 0.22, z))].map((g) => g.toNonIndexed()));
    this.carts = new THREE.InstancedMesh(cartGeo, new THREE.MeshLambertMaterial({ color: 0xb8c0c8, emissive: 0xffffff, emissiveIntensity: 0.2 }), 10);
    this.inside.add(this.carts);
    // caminhos: corredores entre as gôndolas, ida e volta, e a fila do caixa
    for (let i = 0; i < 10; i++) {
      const ax = -16 + (i % 8) * 4.2 + 2.1, route = [[ax, -12], [ax, -42], [ax + (i % 2 ? 4.2 : -4.2), -42], [ax + (i % 2 ? 4.2 : -4.2), -12]];
      if (i >= 7) route.splice(0, 4, [-30, -8 - i], [-24, -20], [-14, -12], [8 + (i - 7) * 4.2 + 1.8, -4]); // na hortifruti e na fila
      const p = this._person({ ...randomLook(200 + i), backpack: null, hat: null }, route[0][0], route[0][1], 0); // cliente sem baú de entrega
      this.shoppers.push({ p, route, k: 1, sp: 0.9 + Math.random() * 0.5, phase: Math.random() * 10, wait: Math.random() * 3 });
    }
  }
  _person(look, x, z, h) {
    const r = makeHuman(look);
    r.position.set(x, 0, z); r.rotation.y = h;
    this.group.add(r); // sem malhas próprias: o CrowdRenderer desenha a partir das juntas (matrizes no mundo)
    return { r, look, phase: 0 };
  }

  _physics() {
    const verts = [], idx = [];
    for (const [lx, lz, hx, hz] of this.colliders) { // caixa local (centro, meia-largura x/z) → triângulos no mundo
      const base = verts.length / 3, H = 4;
      const C = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => this.W(lx + a, lz + b));
      for (const y of [-1, H]) for (const p of C) verts.push(p.x, y, p.z);
      for (let i = 0; i < 4; i++) { const a = i, b = (i + 1) % 4; idx.push(base + a, base + b, base + 4 + b, base + a, base + 4 + b, base + 4 + a); }
    }
    this.collider = this.g.phys.addStatic(new Float32Array(verts), new Uint32Array(idx));
  }

  /** Portas automáticas, clientes andando, interior só perto. Chamar a cada quadro. */
  update(dt, px, pz) {
    const d = Math.hypot(px - this.o.x, pz - this.o.z);
    this.group.visible = d < 700;
    this.inside.visible = d < 140;
    if (!this.inside.visible) return;
    this.products.visible = d < 70; // ~6 mil produtos: só perto
    // porta: abre quando o André chega perto da entrada (dos dois lados)
    const lx = (px - this.o.x) * this.c - (pz - this.o.z) * this.s, lz = (px - this.o.x) * this.s + (pz - this.o.z) * this.c;
    const open = Math.abs(lx) < 4 && Math.abs(lz) < 5 ? 1 : 0;
    this.doorK = (this.doorK || 0) + (open - (this.doorK || 0)) * Math.min(1, dt * 4);
    this.doorL.position.x = -DOM.W / 2 * 0 - 7 / 4 - this.doorK * 1.7;
    this.doorR.position.x = 7 / 4 + this.doorK * 1.7;
    const m4 = new THREE.Matrix4();
    this.shoppers.forEach((s, i) => {
      const r = s.p.r;
      if (s.wait > 0) { s.wait -= dt; animateHuman(r, s.phase, 0); }
      else {
        const [tx, tz] = s.route[s.k], dx = tx - r.position.x, dz = tz - r.position.z, L = Math.hypot(dx, dz);
        if (L < 0.4) { s.k = (s.k + 1) % s.route.length; if (Math.random() < 0.5) s.wait = 1 + Math.random() * 3; }
        else {
          const st = Math.min(L, s.sp * dt);
          r.position.x += (dx / L) * st; r.position.z += (dz / L) * st;
          r.rotation.y = Math.atan2(dx, dz);
          s.phase += dt * 1.8 * s.sp;
          animateHuman(r, s.phase, 0.6);
        }
      }
      // carrinho na frente do cliente
      const a = r.rotation.y;
      m4.makeRotationY(a).setPosition(r.position.x + Math.sin(a) * 0.9, 0, r.position.z + Math.cos(a) * 0.9);
      this.carts.setMatrixAt(i, m4);
    });
    this.carts.instanceMatrix.needsUpdate = true;
    for (const s of this.staff) animateHuman(s.r, 0, 0);
  }

  /** Funcionários e clientes entram no desenho em lote das pessoas (CrowdRenderer). */
  draw(crowd) {
    if (!this.inside.visible) return;
    this.group.updateMatrixWorld();
    for (const s of this.staff) crowd.add(s.r);
    for (const s of this.shoppers) crowd.add(s.p.r);
  }

  /** Letreiro e vitrine acendem à noite. */
  setNight(k) {
    this.logoMat.emissiveIntensity = 0.12 + k * 1.6; // letreiro iluminado à noite
    for (const m of this.glassMats) m.emissiveIntensity = 0.18 + k * 0.6;
  }

  /** Converte o ponto do caixa (local) para o mundo. */
  get counterWorld() { return this.W(this.counter.x - 1.6, this.counter.z + 1.2); }
  get doorWorld() { return this.W(0, 2.5); }
  get spawnWorld() { return this.W(-2, DOM.SET - 9.5); }
}
