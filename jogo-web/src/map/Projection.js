// Converte lon/lat <-> metros locais. x = leste, z = sul (norte = -z).
export class Projection {
  constructor(lon0, lat0) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this.kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    this.kz = 110540;
  }
  toXZ(lon, lat) { return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * this.kz]; }
  toLonLat(x, z) { return [this.lon0 + x / this.kx, this.lat0 - z / this.kz]; }
}
