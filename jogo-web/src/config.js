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

// O jogo começa no Dom Olívio, na Rua do Retiro. O endereço é procurado na internet uma vez e fica salvo.
// Se souber as coordenadas exatas, coloque em lat/lon (ex.: lat: -23.19, lon: -46.88) e a busca é pulada.
export const START = {
  label: 'Dom Olívio · Rua do Retiro',
  name: /dom\s*ol[ií]vio/i,
  street: /retiro/i,
  queries: ['Dom Olívio, Rua do Retiro, Jundiaí', 'Dom Olivio, Jundiaí', 'Rua do Retiro, Jundiaí'],
  lat: null,
  lon: null,
};

// Coordenada manual pela URL (?lat=&lon=), só dentro de Jundiaí. Sem ela, o jogo começa no Dom Olívio.
export function getSpawnOverride() {
  const q = new URLSearchParams(location.search);
  const lat = +q.get('lat'), lon = +q.get('lon');
  if (q.get('lat') && q.get('lon') && insideJundiai(lat, lon)) return { name: 'Jundiaí', lat, lon };
  if (START.lat && START.lon) return { name: START.label, lat: START.lat, lon: START.lon };
  return null;
}

export function getHour() {
  const h = new URLSearchParams(location.search).get('hora');
  return h !== null ? +h : new Date().getHours();
}

// Níveis de gráfico. O jogo começa no Médio e baixa sozinho se o FPS cair; tecla G troca manualmente.
// Sombras reais (PCF suave) no Médio e Alto: prédios, casas, árvores, postes e carros. Pessoas usam blob shadow.
// ao = oclusão de ambiente (GTAO): escureceu demais os prédios nos testes, por isso fica desligada.
export const QUALITY = {
  baixo: { label: 'Baixo', pixelRatio: 0.75, shadows: false, shadowSize: 1024, bloom: false, iv: 1, blur: false, realPeds: 4, peds: 12, traffic: 8, far: 300 },
  medio: { label: 'Médio', pixelRatio: 1, shadows: true, shadowSize: 1024, bloom: true, iv: 1, blur: true, realPeds: 8, peds: 24, traffic: 12, far: 420 },
  alto: { label: 'Alto', pixelRatio: 1.25, shadows: true, shadowSize: 2048, bloom: true, iv: 1, blur: true, ao: false, realPeds: 14, peds: 40, traffic: 18, far: 560 },
};
