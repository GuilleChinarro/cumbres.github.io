'use strict';
/* ===================== 1. Datos de referencia ===================== */
const Ref = {
  ready: false,
  meta: null,
  n: 0,
  ids: null, lat: null, lon: null, name: null, ele: null, sier: null, alt: null,
  nnames: null,
  idIndex: new Map(),
  grid: new Map(),
  CELL: 0.05,
  sierras: [],      // [{name, bbox, polys, area, label}]
  sierraGeo: null,  // FeatureCollection de polígonos
  sierraPts: null,  // FeatureCollection de etiquetas
  base: null,       // capas Natural Earth

  async load() {
    const [pb, sb, bb] = await Promise.all([embedded('d-peaks'), embedded('d-sierras'), embedded('d-base')]);
    this._sierras(JSON.parse(utf8.decode(sb)));
    this._peaks(utf8.decode(pb));
    this.base = JSON.parse(utf8.decode(bb)).layers;
    this.ready = true;
  },

  _sierras(js) {
    const feats = [], pts = [];
    js.items.forEach((it, i) => {
      const polys = it.g.type === 'Polygon' ? [it.g.coordinates] : it.g.coordinates;
      let w = 180, s = 90, e = -180, n = -90, area = 0;
      for (const poly of polys) {
        const ring = poly[0];
        for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
        let a = 0;
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a += (ring[j][0] + ring[k][0]) * (ring[j][1] - ring[k][1]);
        area += Math.abs(a / 2);
      }
      this.sierras.push({ name: it.n, bbox: [w, s, e, n], polys, area, label: it.l });
      feats.push({ type: 'Feature', id: i, properties: { n: it.n }, geometry: it.g });
      pts.push({ type: 'Feature', properties: { n: it.n, a: area }, geometry: { type: 'Point', coordinates: it.l } });
    });
    this.sierraGeo = { type: 'FeatureCollection', features: feats };
    this.sierraPts = { type: 'FeatureCollection', features: pts };
  },

  _peaks(txt) {
    const nl = txt.indexOf('\n');
    this.meta = JSON.parse(txt.slice(0, nl));
    const lines = txt.slice(nl + 1).split('\n');
    const n = lines.length;
    this.n = n;
    this.ids = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    this.ele = new Float32Array(n);
    this.sier = new Int16Array(n);
    this.name = new Array(n);
    this.alt = new Array(n);
    let plat = 0, plon = 0;
    const C = this.CELL;
    for (let i = 0; i < n; i++) {
      const f = lines[i].split('\t');
      const id = parseInt(f[0], 36);
      plat += +f[1]; plon += +f[2];
      const la = plat / 1e5, lo = plon / 1e5;
      this.ids[i] = id; this.lat[i] = la; this.lon[i] = lo;
      this.name[i] = f[3];
      this.ele[i] = f[4] === '' || f[4] === undefined ? NaN : +f[4];
      this.sier[i] = f[5] === '' || f[5] === undefined ? -1 : +f[5];
      this.alt[i] = f[6] || '';
      this.idIndex.set('osm:' + id, i);
      const key = Math.floor(la / C) * 100000 + Math.floor(lo / C);
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, (cell = []));
      cell.push(i);
    }
  },

  /** Índices de cumbres dentro de un rectángulo. */
  query(w, s, e, n) {
    const C = this.CELL, out = [];
    for (let cy = Math.floor(s / C); cy <= Math.floor(n / C); cy++) {
      for (let cx = Math.floor(w / C); cx <= Math.floor(e / C); cx++) {
        const cell = this.grid.get(cy * 100000 + cx);
        if (!cell) continue;
        for (const i of cell) {
          const la = this.lat[i], lo = this.lon[i];
          if (la >= s && la <= n && lo >= w && lo <= e) out.push(i);
        }
      }
    }
    return out;
  },

  peak(i) {
    return {
      id: 'osm:' + this.ids[i], osmId: this.ids[i], name: this.name[i],
      ele: isNaN(this.ele[i]) ? null : this.ele[i], lat: this.lat[i], lon: this.lon[i],
      sierra: this.sier[i] >= 0 ? this.sierras[this.sier[i]]?.name || '' : '', alt: this.alt[i],
    };
  },

  covers(lat, lon) {
    return (this.meta?.cover || []).some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
  },

  search(text, nearLat, nearLon, limit = 25) {
    if (!this.nnames) this.nnames = this.name.map((s, i) => norm(s + (this.alt[i] ? ' ' + this.alt[i] : '')));
    const q = norm(text);
    if (q.length < 2) return [];
    const words = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (let i = 0; i < this.n; i++) {
      const nm = this.nnames[i];
      if (words.every((w) => nm.includes(w))) hits.push(i);
    }
    const d = (i) => (nearLat == null ? 0 : haversine(nearLat, nearLon, this.lat[i], this.lon[i]));
    return hits.map((i) => ({ i, d: d(i) })).sort((a, b) => a.d - b.d).slice(0, limit);
  },

  /** Sierra (nombre GMBA) en un punto; la más pequeña que lo contiene. */
  sierraAt(lon, lat, fuzzy = true) {
    let best = null;
    for (const s of this.sierras) {
      const [w, so, e, n] = s.bbox;
      if (lon < w || lon > e || lat < so || lat > n) continue;
      if (s.polys.some((p) => pointInPolygon(lon, lat, p)) && (!best || s.area < best.area)) best = s;
    }
    if (best || !fuzzy) return best ? best.name : '';
    for (const [dx, dy] of [[0.015, 0], [-0.015, 0], [0, 0.012], [0, -0.012], [0.01, 0.01], [-0.01, -0.01], [0.01, -0.01], [-0.01, 0.01]]) {
      const s = this.sierraAt(lon + dx, lat + dy, false);
      if (s) return s;
    }
    return '';
  },
};
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, poly) {
  if (!pointInRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (pointInRing(x, y, poly[k])) return false;
  return true;
}
