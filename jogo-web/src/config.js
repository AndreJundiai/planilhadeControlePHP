// O jogo só funciona dentro de Jundiaí (SP).
// Dá para escolher outro ponto DENTRO do município pela URL: ?lat=-23.20&lon=-46.88
// Limites aproximados do município de Jundiaí:
export const JUNDIAI_BOUNDS = { south: -23.33, north: -23.07, west: -47.05, east: -46.80 };
export const CONFIG = {
  presets: {
    jundiai: { name: 'Jundiaí - Centro', lon: -46.8845, lat: -23.1866 },
  },
  chunk: 0.004, // tamanho do bloco do mapa em graus (~420 m); carrega 3x3 blocos ao redor do jogador
  maxPeds: 40,
  maxTraffic: 18,
  police: 3,
  minimapStyle: 'https://tiles.openfreemap.org/styles/liberty',
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
};

export const insideJundiai = (lat, lon) =>
  lat >= JUNDIAI_BOUNDS.south && lat <= JUNDIAI_BOUNDS.north && lon >= JUNDIAI_BOUNDS.west && lon <= JUNDIAI_BOUNDS.east;

export function getSpawn() {
  const q = new URLSearchParams(location.search);
  const lat = +q.get('lat'), lon = +q.get('lon');
  if (q.get('lat') && q.get('lon') && insideJundiai(lat, lon)) return { name: 'Jundiaí', lat, lon };
  return CONFIG.presets.jundiai; // fora de Jundiaí: volta para o centro
}

export function getHour() {
  const h = new URLSearchParams(location.search).get('hora');
  return h !== null ? +h : new Date().getHours();
}

// Níveis de gráfico. O jogo começa no Médio e baixa sozinho se o FPS cair; tecla G troca manualmente.
export const QUALITY = {
  baixo: { label: 'Baixo', pixelRatio: 0.75, shadows: false, shadowSize: 1024, peds: 12, traffic: 8, far: 380, sky: false },
  medio: { label: 'Médio', pixelRatio: 1, shadows: true, shadowSize: 1024, peds: 24, traffic: 12, far: 560, sky: true },
  alto: { label: 'Alto', pixelRatio: 1.5, shadows: true, shadowSize: 2048, peds: 40, traffic: 18, far: 760, sky: true },
};
