import * as THREE from 'three';

/**
 * Texturas 100% procedurais desenhadas em <canvas> na memória (zero imagens para baixar).
 * Cada gerador roda uma vez só (cache) e devolve uma THREE.CanvasTexture pronta para repetir.
 * Os desenhos usam um gerador pseudoaleatório com semente: o resultado é igual em toda partida.
 */

const cache = new Map();
let ANISO = 4;
const ALL = new Set();

/** Chamado depois de criar o renderer: aplica o filtro anisotrópico máximo da placa de vídeo. */
export function setAnisotropy(n) {
  ANISO = Math.max(1, Math.min(8, n || 1));
  for (const t of ALL) { t.anisotropy = t.userData.aniso ? ANISO : 1; t.needsUpdate = true; }
}

function canvas(w, h) {
  if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  return new OffscreenCanvas(w, h);
}

// gerador pseudoaleatório com semente (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function texture(c, { repeat = 1, srgb = true, aniso = true, nearest = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (typeof repeat === 'number') t.repeat.set(repeat, repeat); else t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.userData.aniso = aniso && !nearest;
  t.anisotropy = t.userData.aniso ? ANISO : 1;
  ALL.add(t);
  return t;
}

const once = (key, make) => cache.get(key) || cache.set(key, make()).get(key);

// Ruído por pixel (grão) somado à imagem atual: amp = variação máxima de brilho (0–255).
function grain(g, w, h, amp, R, tint = [1, 1, 1]) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amp;
    d[i] += n * tint[0]; d[i + 1] += n * tint[1]; d[i + 2] += n * tint[2];
  }
  g.putImageData(img, 0, 0);
}

// Mancha macia (óleo, sujeira, umidade).
function blot(g, x, y, r, color, alpha) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace('A', alpha));
  gr.addColorStop(1, color.replace('A', 0));
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

// Desenha a mancha também do outro lado das bordas, para a textura repetir sem emenda.
function wrapDraw(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) if (x + ox > -r && x + ox < w + r && y + oy > -r && y + oy < h + r) fn(x + ox, y + oy);
}

// Rachadura: caminho aleatório fino e escuro com galhos.
function crack(g, R, x, y, len, w, h) {
  g.strokeStyle = 'rgba(12,12,14,0.55)';
  g.lineWidth = 0.6 + R() * 0.9;
  let a = R() * Math.PI * 2;
  g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    a += (R() - 0.5) * 1.1;
    x += Math.cos(a) * 3; y += Math.sin(a) * 3;
    g.lineTo(x, y);
    if (R() < 0.08) { g.stroke(); crack(g, R, x, y, len * 0.4, w, h); g.beginPath(); g.moveTo(x, y); }
  }
  g.stroke();
}

/** Asfalto: grão de agregado, remendos, microfissuras e manchas de óleo. Tile de 8 m. */
export function asphaltTexture() {
  return once('asphalt', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(11);
    g.fillStyle = '#46464b'; g.fillRect(0, 0, S, S);
    // agregado: pedrinhas claras e escuras
    for (let i = 0; i < 9000; i++) {
      const v = R() < 0.5 ? 30 + R() * 30 : 95 + R() * 60;
      g.fillStyle = `rgb(${v},${v},${v + 4})`;
      g.fillRect(R() * S, R() * S, 1 + R() * 1.6, 1 + R() * 1.6);
    }
    // remendos de recapeamento (retângulos um pouco mais escuros)
    for (let i = 0; i < 4; i++) {
      const x = R() * S, y = R() * S, w = 40 + R() * 120, h = 30 + R() * 90;
      wrapDraw(S, S, x, y, Math.max(w, h), (px, py) => { g.fillStyle = 'rgba(20,20,24,0.22)'; g.fillRect(px, py, w, h); });
    }
    // manchas de óleo e de umidade
    for (let i = 0; i < 14; i++) {
      const x = R() * S, y = R() * S, r = 10 + R() * 40;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(8,8,12,A)', 0.18 + R() * 0.25));
    }
    for (let i = 0; i < 6; i++) crack(g, R, R() * S, R() * S, 25 + R() * 40, S, S);
    grain(g, S, S, 26, R);
    return texture(c, { repeat: 1 / 8 });
  });
}

/** Calçada: placas de concreto claro com juntas de dilatação e sujeira. Tile de 6 m (placas de 1,5 m). */
export function concreteTexture() {
  return once('concrete', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(23), N = 4, step = S / N;
    g.fillStyle = '#b9b5ac'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { // cada placa com tom próprio
      const v = 168 + R() * 26;
      g.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
      g.fillRect(i * step, j * step, step, step);
    }
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S, r = 12 + R() * 50;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(70,62,50,A)', 0.08 + R() * 0.14));
    }
    for (let i = 0; i < 3; i++) crack(g, R, R() * S, R() * S, 12 + R() * 15, S, S);
    // juntas de dilatação
    g.fillStyle = 'rgba(55,52,48,0.85)';
    for (let i = 0; i < N; i++) { g.fillRect(i * step, 0, 3, S); g.fillRect(0, i * step, S, 3); }
    grain(g, S, S, 18, R);
    return texture(c, { repeat: 1 / 6 });
  });
}

/** Reboco texturizado (cinza claro, multiplicado pela cor de cada prédio). Tile de 6,4 m. */
export function plasterTexture() {
  return once('plaster', () => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(37);
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 26; i++) {
      const x = R() * S, y = R() * S, r = 8 + R() * 40;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(120,115,105,A)', 0.06 + R() * 0.08));
    }
    // escorrido de chuva saindo das janelas (faixas verticais suaves)
    for (let i = 0; i < 10; i++) {
      const x = R() * S, w = 2 + R() * 6, gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, 'rgba(90,85,80,0.16)'); gr.addColorStop(1, 'rgba(90,85,80,0)');
      g.fillStyle = gr; g.fillRect(x, R() * S * 0.5, w, S);
    }
    grain(g, S, S, 22, R);
    return texture(c, { repeat: 1 / 6.4 });
  });
}

/** Tijolo aparente (galpões históricos, FEPASA). Tile de 3,2 m: 14 fiadas. */
export function brickTexture() {
  return once('brick', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(41);
    const rows = 28, bh = S / rows, bw = bh * 2.6;
    g.fillStyle = '#b7ab98'; g.fillRect(0, 0, S, S); // argamassa
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let x = -bw; x < S + bw; x += bw) {
        const v = R();
        g.fillStyle = `rgb(${130 + v * 50},${56 + v * 26},${38 + v * 16})`;
        g.fillRect(x + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
        if (R() < 0.12) { g.fillStyle = 'rgba(30,20,15,0.25)'; g.fillRect(x + off + 1.5, r * bh + 1.5, bw - 3, bh - 3); }
      }
    }
    for (let i = 0; i < 18; i++) {
      const x = R() * S, y = R() * S, r = 20 + R() * 60;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(40,30,25,A)', 0.1 + R() * 0.15));
    }
    grain(g, S, S, 20, R);
    return texture(c, { repeat: 1 / 3.2 });
  });
}

/**
 * Mapa de luz das janelas (emissiveMap): grade 16x16 = uma janela por célula de fachada (3,2 m).
 * Cada célula sorteia: apagada, luz quente de sala, branca de escritório ou azul de TV.
 * O shader da fachada lê a célula da janela e multiplica pela noite (acende sozinho ao escurecer).
 */
export function windowLightTexture() {
  return once('winlight', () => {
    const N = 16, S = N * 4, c = canvas(S, S), g = c.getContext('2d'), R = rng(53);
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const tones = ['#ffcf7a', '#ffb85c', '#fff1d0', '#e8f0ff', '#8fb6ff', '#ffd9a0'];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (R() < 0.42) continue; // apagada
      g.fillStyle = tones[Math.floor(R() * tones.length)];
      g.globalAlpha = 0.55 + R() * 0.45;
      g.fillRect(i * 4, j * 4, 4, 4);
    }
    g.globalAlpha = 1;
    return texture(c, { nearest: true });
  });
}

/** Telha cerâmica (capa-e-canal) para os telhados inclinados das casas. Tile de 2 m. */
export function roofTileTexture() {
  return once('rooftile', () => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(61), rows = 8, cols = 10, rh = S / rows, cw = S / cols;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const v = R(), x = k * cw + (r % 2 ? cw / 2 : 0);
        const gr = g.createLinearGradient(x, 0, x + cw, 0); // telha curva: claro no meio, escuro nas bordas
        const base = [168 + v * 40, 74 + v * 26, 46 + v * 14];
        gr.addColorStop(0, `rgb(${base[0] * 0.62},${base[1] * 0.62},${base[2] * 0.62})`);
        gr.addColorStop(0.5, `rgb(${base[0]},${base[1]},${base[2]})`);
        gr.addColorStop(1, `rgb(${base[0] * 0.62},${base[1] * 0.62},${base[2] * 0.62})`);
        g.fillStyle = gr;
        for (const ox of [0, -S]) g.fillRect(x + ox, r * rh, cw, rh);
      }
      g.fillStyle = 'rgba(25,10,5,0.45)'; g.fillRect(0, (r + 1) * rh - 3, S, 3); // sombra da fiada de cima
    }
    for (let i = 0; i < 16; i++) {
      const x = R() * S, y = R() * S, r = 10 + R() * 40;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(35,40,25,A)', 0.1 + R() * 0.2)); // limo
    }
    grain(g, S, S, 18, R);
    return texture(c, { repeat: 1 / 2 });
  });
}

/** Estacionamento: asfalto com vagas pintadas (2,5 m) e setas. Tile de 10 m. */
export function parkingTexture() {
  return once('parking', () => {
    const S = 512, c = canvas(S, S), g = c.getContext('2d'), R = rng(71);
    g.drawImage(asphaltTexture().image, 0, 0, S, S);
    g.fillStyle = 'rgba(235,235,228,0.85)';
    const px = S / 10; // pixels por metro
    for (let x = 0; x < S; x += 2.5 * px) { g.fillRect(x, 0.3 * px, 3, 4.8 * px); g.fillRect(x, S - 5.1 * px, 3, 4.8 * px); }
    g.fillRect(0, 5.1 * px, S, 3); g.fillRect(0, S - 5.1 * px, S, 3);
    g.font = `bold ${px * 1.2}px sans-serif`; g.textAlign = 'center';
    g.fillText('→', S / 2, S / 2 + px * 0.4);
    grain(g, S, S, 10, R);
    return texture(c, { repeat: 1 / 10 });
  });
}

/** Grama de parque com touceiras e trilhas de terra. Tile de 12 m. */
export function grassTexture() {
  return once('grass', () => {
    const S = 256, c = canvas(S, S), g = c.getContext('2d'), R = rng(83);
    g.fillStyle = '#4f7a36'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4000; i++) {
      const v = R();
      g.fillStyle = `rgb(${50 + v * 50},${90 + v * 60},${30 + v * 25})`;
      g.fillRect(R() * S, R() * S, 1, 2 + R() * 3);
    }
    for (let i = 0; i < 10; i++) {
      const x = R() * S, y = R() * S, r = 10 + R() * 26;
      wrapDraw(S, S, x, y, r, (px, py) => blot(g, px, py, r, 'rgba(120,100,60,A)', 0.15 + R() * 0.2));
    }
    grain(g, S, S, 20, R, [0.7, 1, 0.5]);
    return texture(c, { repeat: 1 / 12 });
  });
}

/** Via férrea: brita, dormentes de madeira a cada 60 cm e dois trilhos de aço. u atravessa a faixa (0–1). */
export function railTexture() {
  return once('rail', () => {
    const W = 128, H = 128, c = canvas(W, H), g = c.getContext('2d'), R = rng(97);
    g.fillStyle = '#6e665c'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2500; i++) { const v = 70 + R() * 90; g.fillStyle = `rgb(${v},${v - 6},${v - 14})`; g.fillRect(R() * W, R() * H, 2, 2); }
    for (let y = 0; y < H; y += H / 4) { // 4 dormentes por tile (2,4 m)
      g.fillStyle = `rgb(${70 + R() * 20},${48 + R() * 12},${30})`;
      g.fillRect(W * 0.1, y + 4, W * 0.8, H / 4 - 14);
    }
    for (const x of [0.33, 0.67]) { g.fillStyle = '#9da3a8'; g.fillRect(W * x - 3, 0, 6, H); g.fillStyle = '#d8dde0'; g.fillRect(W * x - 1, 0, 2, H); }
    grain(g, W, H, 14, R);
    return texture(c, { repeat: [1, 1 / 2.4] });
  });
}

/** Brilho redondo (fumaça, halo, faróis). */
export function softDotTexture() {
  return once('dot', () => {
    const S = 64, c = canvas(S, S), g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    const t = texture(c, { srgb: false, aniso: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/**
 * Letreiro comercial pintado com ctx.fillText(): fundo na cor da marca, faixa de destaque,
 * nome grande e uma segunda linha (ex.: "24 HORAS"). Usado como map e emissiveMap (acende à noite).
 */
export function signTexture(text, sub, bg, fg = '#ffffff', accent = '#ffd400') {
  return once(`sign|${text}|${sub}|${bg}|${fg}|${accent}`, () => {
    const W = 512, H = 192, c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = accent; g.fillRect(0, H - 34, W, 34); g.fillRect(0, 0, W, 10);
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 6; g.strokeRect(10, 16, W - 20, H - 58);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 92;
    g.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(text).width > W - 50 && size > 30) { size -= 4; g.font = `900 ${size}px "Arial Black", Arial, sans-serif`; }
    g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowOffsetY = 4;
    g.fillText(text, W / 2, sub ? 76 : 88);
    g.shadowColor = 'transparent';
    if (sub) { g.font = 'bold 30px Arial, sans-serif'; g.fillText(sub, W / 2, 136); }
    g.fillStyle = bg === accent ? '#ffffff' : bg;
    g.font = 'bold 20px Arial, sans-serif';
    g.fillText('JUNDIAÍ · SP', W / 2, H - 17);
    const t = texture(c, { repeat: 1 });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
