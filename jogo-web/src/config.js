// Configuração geral. Troque a cidade pela URL: ?city=paulista  ou  ?lat=-23.18&lon=-46.88
export const CONFIG = {
  presets: {
    jundiai: { name: 'Jundiaí - Centro', lon: -46.8845, lat: -23.1866 },
    paulista: { name: 'Av. Paulista - São Paulo', lon: -46.6559, lat: -23.5614 },
  },
  radius: 700, // metros carregados ao redor do spawn
  peds: 40,
  traffic: 18,
  police: 3,
  minimapStyle: 'https://tiles.openfreemap.org/styles/liberty',
  overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
};

export function getSpawn() {
  const q = new URLSearchParams(location.search);
  if (q.get('lat') && q.get('lon')) return { name: 'Coordenada', lat: +q.get('lat'), lon: +q.get('lon') };
  return CONFIG.presets[q.get('city')] || CONFIG.presets.jundiai;
}

export function getHour() {
  const h = new URLSearchParams(location.search).get('hora');
  return h !== null ? +h : new Date().getHours();
}
