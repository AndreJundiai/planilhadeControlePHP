import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { signTexture } from '../render/ProceduralTextures.js';

/**
 * Supermercados, atacadistas e pontos famosos de Jundiaí.
 * As POSIÇÕES vêm do OpenStreetMap (lojas com nome no mapa real); aqui só reconhecemos o nome e
 * erguemos um totem com o letreiro pintado em Canvas 2D (fillText), nas cores da marca.
 * O letreiro usa a mesma textura como emissiveMap: à noite ele acende sozinho (o Tauste, 24 h, mais forte).
 * Nada é inventado: se uma loja não está no mapa do OSM daquele bloco, o totem dela não aparece.
 */
export const BRANDS = [
  { re: /\bboa\b.*(super|merc)|(super|merc).*\bboa\b|^boa$/i, text: 'BOA', sub: 'SUPERMERCADOS', bg: '#1f4fa8', accent: '#d62828' },
  { re: /tauste/i, text: 'TAUSTE', sub: 'SUPERMERCADO · 24 HORAS', bg: '#1a4fa0', accent: '#f28c1c', glow: 1.7 },
  { re: /coopercica/i, text: 'COOPERCICA', sub: 'SUPERMERCADO', bg: '#1e8a3c', accent: '#ffd400' },
  { re: /s[ãa]o vicente/i, kind: /super|merc/i, text: 'SÃO VICENTE', sub: 'SUPERMERCADO', bg: '#1d4f9c', accent: '#d62828' },
  { re: /monte serrat/i, text: 'MONTE SERRAT', sub: 'SUPERMERCADO', bg: '#8f1d22', accent: '#f4f1ea' },
  { re: /rold[ãa]o/i, text: 'ROLDÃO', sub: 'ATACADISTA', bg: '#f07c00', accent: '#0b3d91' },
  { re: /\bassa[ií](?![a-z])/i, text: 'ASSAÍ', sub: 'ATACADISTA', bg: '#0a3d8f', accent: '#f58220' },
  { re: /atacad[ãa]o/i, text: 'ATACADÃO', sub: 'ATACADO E VAREJO', bg: '#d71920', accent: '#ffd200' },
  { re: /\bfort\b/i, kind: /atacad/i, text: 'FORT', sub: 'ATACADISTA', bg: '#0b4a8b', accent: '#ffcc00' },
  { re: /ricoy/i, text: 'RICOY', sub: 'SUPERMERCADOS', bg: '#c8102e', accent: '#ffffff' },
  { re: /millen+ium/i, text: 'MILLENNIUM', sub: 'SUPERMERCADO', bg: '#5b2d8e', accent: '#ffd400' },
  { re: /tarum[ãa]/i, kind: /super|merc/i, text: 'TARUMÃ', sub: 'SUPERMERCADO', bg: '#00796b', accent: '#ffeb3b' },
  { re: /mercad[ãa]o/i, text: 'MERCADÃO', sub: 'VILA ARENS', bg: '#6d4c41', accent: '#ffc107' },
  { re: /jundia[ií] ?shopping/i, text: 'JUNDIAÍSHOPPING', sub: '', bg: '#20252b', accent: '#e53935', glow: 1.3, tall: 1.5 },
  { re: /maxi shopping/i, text: 'MAXI SHOPPING', sub: 'JUNDIAÍ', bg: '#0d47a1', accent: '#ffca28', glow: 1.3, tall: 1.5 },
];

// Pontos turísticos e prédios públicos: placa marrom de turismo (padrão brasileiro).
export const LANDMARKS = [
  { re: /catedral|desterro/i, text: 'CATEDRAL', sub: 'N. SRA. DO DESTERRO' },
  { re: /pa[çc]o municipal|prefeitura de jundia/i, text: 'PAÇO MUNICIPAL', sub: 'PREFEITURA' },
  { re: /terminal (central|vila arens|eloy|hortol|rami|colonia)/i, text: 'TERMINAL', sub: '' },
  { re: /fepasa/i, text: 'COMPLEXO FEPASA', sub: 'PATRIMÔNIO FERROVIÁRIO' },
  { re: /ponte torta/i, text: 'PONTE TORTA', sub: 'PATRIMÔNIO HISTÓRICO' },
  { re: /parque da cidade/i, text: 'PARQUE DA CIDADE', sub: '' },
  { re: /jardim bot[âa]nico/i, text: 'JARDIM BOTÂNICO', sub: '' },
  { re: /serra do japi/i, text: 'SERRA DO JAPI', sub: 'RESERVA BIOLÓGICA' },
];

const SUPER = /supermarket|wholesale|convenience|greengrocer|mall|department_store/;

function match(place) {
  if (/dom ol[ií]vio/i.test(place.name)) return null; // o Dom Olívio tem prédio modelado (src/map/DomOlivio.js), sem totem
  for (const b of BRANDS) if (b.re.test(place.name) && (!b.kind || b.kind.test(place.name) || SUPER.test(place.kind))) return { ...b, brand: true, sub: b.kind && !b.sub ? '' : b.sub };
  for (const l of LANDMARKS) if (l.re.test(place.name)) return { ...l, bg: '#6b3e1f', accent: '#ffffff', fg: '#ffffff', tourist: true };
  if (SUPER.test(place.kind)) { // outro mercado do mapa: letreiro com o nome dele mesmo
    const hue = [...place.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    return { text: place.name.toUpperCase().slice(0, 22), sub: place.kind === 'wholesale' ? 'ATACADO' : 'SUPERMERCADO', bg: `hsl(${hue},60%,34%)`, accent: '#ffd400', brand: true };
  }
  return null;
}

const POLE_MAT = new THREE.MeshLambertMaterial({ color: 0x5c6066 });
const poleCache = new Map();
function poles(W, H) { // dois postes numa geometria só
  const k = W + '|' + H;
  if (!poleCache.has(k)) poleCache.set(k, mergeGeometries([-0.35, 0.35].map((x) => new THREE.CylinderGeometry(0.16, 0.2, H, 8).translate(x * W, H / 2, 0))));
  return poleCache.get(k);
}
// Caixa do letreiro com UM material: frente e verso mostram o letreiro; as laterais pegam a cor de fundo
// da própria textura (um texel da borda). 1 draw call em vez de 6 (um por face).
function signBox(W, SH) {
  const g = new THREE.BoxGeometry(W, SH, 0.35), uv = g.attributes.uv;
  for (let face = 0; face < 4; face++) for (let i = 0; i < 4; i++) uv.setXY(face * 4 + i, 0.006, 0.5);
  g.clearGroups();
  return g;
}

export class Landmarks {
  constructor(game) {
    this.g = game;
    this.done = new Set();
    this.list = []; // { x, z, group, face, glow, color, name }
    this.night = 0;
  }

  /** Procura lojas/pontos novos (chamado depois de cada bloco do mapa montado). */
  scan() {
    const g = this.g;
    for (const p of g.streamer.places) {
      const key = p.name + '|' + Math.round(p.x / 25) + ',' + Math.round(p.z / 25);
      if (this.done.has(key)) continue;
      this.done.add(key);
      const m = match(p);
      if (m) this._totem(p, m);
    }
  }

  // Totem ao lado da rua mais próxima, perpendicular à via (visível nos dois sentidos).
  _totem(p, m) {
    const g = this.g, node = g.carGraph.nearest(p.x, p.z);
    let x = p.x, z = p.z, h = 0;
    if (node && Math.hypot(node.x - p.x, node.z - p.z) < 120) {
      const dx = p.x - node.x, dz = p.z - node.z, d = Math.hypot(dx, dz) || 1;
      // anda do centro da rua em direção à loja até sair da pista e da calçada (e de dentro de prédios)
      let k = Math.min(d, 9);
      x = node.x + (dx / d) * k; z = node.z + (dz / d) * k;
      for (let i = 0; i < 8 && g.streamer.insideBuilding(x, z); i++) { k -= 1; x = node.x + (dx / d) * k; z = node.z + (dz / d) * k; }
      const e = node.edges[0];
      if (e) { const o = g.carGraph.nodes.get(e.to); if (o) h = Math.atan2(o.x - node.x, o.z - node.z); }
    }
    const tall = m.tall || 1, H = (m.tourist ? 3.2 : 6.5) * tall, W = (m.tourist ? 3.6 : 5.2) * tall, SH = W * (192 / 512);
    const tex = signTexture(m.text, m.sub || '', m.bg, m.fg || '#ffffff', m.accent || '#ffd400');
    const face = new THREE.MeshLambertMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(poles(W, H), POLE_MAT);
    pole.castShadow = true;
    grp.add(pole);
    const box = new THREE.Mesh(signBox(W, SH), face);
    box.position.y = H + SH / 2;
    box.castShadow = true;
    grp.add(box);
    grp.position.set(x, 0, z);
    grp.rotation.y = h; // placa de frente para quem vem pela rua
    g.scene.add(grp);
    this.list.push({ x, z, group: grp, face, glow: m.glow || 1, color: m.accent && m.brand ? m.bg : '#8d5a2b', name: p.name, brand: !!m.brand, text: m.text });
  }

  /** Letreiros acendem à noite (o 24 h brilha mais). */
  setNight(k) {
    this.night = k;
    for (const s of this.list) s.face.emissiveIntensity = 0.12 + k * 0.95 * s.glow;
  }

  /** Só desenha os totens perto (o resto fica na névoa). */
  update(px, pz) {
    for (const s of this.list) s.group.visible = Math.hypot(s.x - px, s.z - pz) < 520;
  }

  /** Marcadores do minimapa: mercados e pontos turísticos próximos. */
  markers(px, pz) {
    const out = [];
    for (const s of this.list) if (Math.hypot(s.x - px, s.z - pz) < 450) out.push({ x: s.x, z: s.z, color: s.brand ? s.color : '#a0632f', r: 5 });
    return out;
  }
}
