'use strict';
/* ===================== 9. Mapa ===================== */
const CDN = {
  maplibre: ['vendor/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js', 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.24.0/maplibre-gl.js'],
};
const WMTS = (svc, layer) => `https://www.ign.es/wmts/${svc}?service=WMTS&request=GetTile&version=1.0.0&layer=${layer}&style=default&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}&format=image/jpeg`;
const TILES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© colaboradores de OpenStreetMap' },
  'ign-topo': { url: WMTS('mapa-raster', 'MTN'), max: 17, attr: 'Mapa topográfico © IGN España' },
  'ign-orto': { url: WMTS('pnoa-ma', 'OI.OrthoimageCoverage'), max: 19, attr: 'PNOA © IGN España' },
};
/* Relieve para el 3D: Mapterhorn (MDT02 del IGN, 2 m en toda España) y, de respaldo, Terrain Tiles de AWS (~30 m). */
const OVERLAYS = {
  senderos: { url: 'https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png', max: 18, attr: 'Senderos © <a href="https://hiking.waymarkedtrails.org" target="_blank" rel="noopener">Waymarked Trails</a> (OSM)' },
};
const DEMS = {
  mapterhorn: { url: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp', tileSize: 512, maxzoom: 17, attr: 'Relieve: <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">Mapterhorn</a> (MDT02 IGN, Copernicus)' },
  aws: { url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', tileSize: 256, maxzoom: 15, attr: 'Relieve: Terrain Tiles (Mapzen, AWS)' },
};
const EXAGS = [1, 1.3, 1.6, 2];
function tileUrlAt(tpl, lon, lat, z) {
  const n = 2 ** z, la = toRad(clamp(lat, -85, 85));
  const x = Math.floor(((lon + 180) / 360) * n), y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  return tpl.replace('{z}', z).replace('{x}', clamp(x, 0, n - 1)).replace('{y}', clamp(y, 0, n - 1));
}
const EMPTY_FC = { type: 'FeatureCollection', features: [] };
const SPAIN = [-9.6, 35.9, 3.5, 43.9];
const BASE_LAYERS = ['land', 'sierras-fill', 'lakes', 'rivers', 'provinces', 'borders', 'roads', 'sierras-line', 'places-dot', 'places-label', 'sierras-label', 'allpeaks', 'allpeaks-label'];

function loadScript(src, timeout = 20000) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const t = setTimeout(() => { s.remove(); rej(new Error('tiempo agotado')); }, timeout);
    s.onload = () => { clearTimeout(t); res(); };
    s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('error de carga')); };
    document.head.appendChild(s);
  });
}
async function loadScriptAny(urls, check) {
  for (const u of urls) {
    try { await loadScript(u); if (check()) return; } catch (e) { console.warn('No se pudo cargar', u, e.message); }
  }
  throw new Error('no se pudo cargar la librería del mapa');
}
function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
/** ¿Deja esta vista crear Web Workers? MapLibre los necesita. */
function probeWorker() {
  return new Promise((res) => {
    let w = null, url = null, done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      try { if (w) w.terminate(); } catch {}
      try { if (url) URL.revokeObjectURL(url); } catch {}
      res(v);
    };
    const t = setTimeout(() => fin(false), 3000);
    try {
      url = URL.createObjectURL(new Blob(['self.onmessage=function(e){self.postMessage(e.data)}'], { type: 'text/javascript' }));
      w = new Worker(url);
      w.onmessage = () => fin(true);
      w.onerror = () => fin(false);
      w.postMessage(1);
    } catch { fin(false); }
  });
}
function probeImage(url, ms = 6000) {
  return new Promise((res) => {
    const img = new Image();
    let done = false;
    const fin = (v) => { if (!done) { done = true; clearTimeout(t); res(v); } };
    const t = setTimeout(() => fin(false), ms);
    img.crossOrigin = 'anonymous';
    img.onload = () => fin(img.naturalWidth > 0);
    img.onerror = () => fin(false);
    img.src = url;
  });
}
/** ¿Hay cartografía externa? (dentro de Claude no: la página no puede pedir nada fuera) */
async function probeNetwork() {
  const z6 = (u) => u.replace('{z}', '6').replace('{x}', '31').replace('{y}', '24');
  const keys = Object.keys(TILES);
  const res = await Promise.all([...keys.map((k) => probeImage(z6(TILES[k].url))), probeImage(z6(DEMS.mapterhorn.url)), probeImage(z6(DEMS.aws.url)), probeImage(z6(OVERLAYS.senderos.url))]);
  Net.trails = !!res[keys.length + 2];
  keys.forEach((k, i) => { Net.tiles[k] = res[i]; });
  Net.dem = res[keys.length] ? 'mapterhorn' : res[keys.length + 1] ? 'aws' : false;
  Net.online = res.some(Boolean);
}

/* Glifos incluidos (Noto Sans) para las etiquetas de MapLibre sin servidor de fuentes */
const Glyphs = {
  map: new Map(),
  async load() {
    if (this.map.size) return;
    const u8 = new Uint8Array(await embedded('d-glyphs'));
    const nl = u8.indexOf(10);
    const head = JSON.parse(utf8.decode(u8.subarray(0, nl)));
    let off = nl + 1;
    for (const [name, size] of head.fonts) { this.map.set(name, u8.slice(off, off + size).buffer); off += size; }
  },
};
async function glyphLoader(params) {
  const m = /^ccglyphs:\/\/([^/]+)\/(\d+)-(\d+)/.exec(params.url);
  if (!m || +m[2] !== 0) return { data: new ArrayBuffer(0) };
  let buf = null;
  for (const s of decodeURIComponent(m[1]).split(',')) if ((buf = Glyphs.map.get(s.trim()))) break;
  buf = buf || Glyphs.map.get('Noto Sans Regular');
  return { data: buf.slice(0) };
}

function mapColors(dark) {
  return dark ? {
    sea: '#0f1b22', land: '#1b221e', sierra: '#262d24', sierraLine: '#6e5c45', sierraText: '#cfa680', water: '#18374a',
    river: '#3e7ea5', admin: '#46514b', border: '#8c968f', road: '#4f4438', place: '#cdd4cf', halo: '#151b18', ink: '#e6ebe7',
    casing: '#0b100e', summit: '#f05a54', near: '#f0c048', osmPeak: '#c08f66', osmText: '#bcae9b', cursor: '#ffffff', hill: '#000000',
  } : {
    sea: '#d6e4ea', land: '#f3f3ed', sierra: '#e7e4d2', sierraLine: '#b39c80', sierraText: '#86664a', water: '#b8d3e3',
    river: '#7aaed0', admin: '#c4c8be', border: '#7b8179', road: '#d9c5ad', place: '#3a443f', halo: '#fbfbf8', ink: '#1e2622',
    casing: '#ffffff', summit: '#cc2b2b', near: '#c48a00', osmPeak: '#9a5a2c', osmText: '#6d5641', cursor: '#1e2622', hill: '#473b2c',
  };
}
/** Símbolo de vértice geodésico para el mapa. */
function vertexBitmap(kind, C) {
  const pr = Math.min(2, Math.ceil(window.devicePixelRatio || 1));
  const size = (kind === 'osm' ? 11 : kind === 'near' || kind === 'todo' ? 17 : 21) * pr;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const pad = 1.7 * pr;
  g.beginPath();
  g.moveTo(size / 2, pad);
  g.lineTo(size - pad, size - pad);
  g.lineTo(pad, size - pad);
  g.closePath();
  g.lineJoin = 'round';
  const dot = (col) => { g.beginPath(); g.arc(size / 2, (pad + 2 * (size - pad)) / 3, size * 0.11, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
  if (kind === 'climbed') { g.fillStyle = C.summit; g.fill(); g.lineWidth = 1.6 * pr; g.strokeStyle = C.halo; g.stroke(); dot(C.halo); }
  else if (kind === 'near') { g.fillStyle = C.halo; g.fill(); g.lineWidth = 2 * pr; g.strokeStyle = C.near; g.stroke(); dot(C.near); }
  else if (kind === 'todo') { g.fillStyle = C.halo; g.fill(); g.lineWidth = 2 * pr; g.strokeStyle = C.osmPeak; g.stroke(); }
  else { g.fillStyle = C.osmPeak; g.fill(); }
  return { data: g.getImageData(0, 0, size, size), pr };
}
function allPeaksFC() {
  const f = new Array(Ref.n);
  for (let i = 0; i < Ref.n; i++) {
    const p = { id: 'osm:' + Ref.ids[i], n: Ref.name[i] };
    if (!isNaN(Ref.ele[i])) p.e = Ref.ele[i];
    f[i] = { type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [Ref.lon[i], Ref.lat[i]] } };
  }
  return { type: 'FeatureCollection', features: f };
}
function trackParts(P, latFirst = false) {
  const parts = [];
  let cur = [];
  for (let i = 0; i < P.n; i++) {
    if (i && P.seg[i] !== P.seg[i - 1]) { if (cur.length > 1) parts.push(cur); cur = []; }
    cur.push(latFirst ? [P.lat[i], P.lon[i]] : [P.lon[i], P.lat[i]]);
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}
function trackGeometry(P) {
  const parts = trackParts(P);
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}
/** Cumbres que se dibujan: las de las rutas visibles; «subida» gana a «cerca». */
function mapPeaks(routes) {
  const M = mountains();
  const out = new Map();
  for (const r of routes) {
    for (const pe of r.peaks) {
      const st = statusOf(r, pe);
      if (st === 'none') continue;
      const cur = out.get(pe.id);
      if (cur && (cur.st === 'climbed' || st === 'near')) continue;
      const m = M.get(pe.id);
      const info = (m && m.info) || peakInfo(pe.id, pe);
      if (!info) continue;
      out.set(pe.id, { id: pe.id, n: info.name, e: info.ele, st, k: m ? m.climbs.length : 0, lat: info.lat, lon: info.lon });
    }
  }
  return [...out.values()];
}
function routesBounds(routes) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const r of routes) { const b = r && r.bbox; if (!b) continue; w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]); }
  return w <= e ? [w, s, e, n] : null;
}
/** 3D sin modelo de elevación: cada track como una cortina hasta su altitud real, y un poste en cada cumbre. */
function wallsFC(routes, peaks) {
  let floor = Infinity;
  for (const r of routes) if (r._P.ele && r.stats && r.stats.minEle != null) floor = Math.min(floor, r.stats.minEle);
  if (!isFinite(floor)) return EMPTY_FC;
  floor = Math.max(0, floor - 80);
  const feats = [];
  const per = Math.max(120, Math.floor(50000 / Math.max(1, routes.length)));
  for (const r of routes) {
    const P = r._P;
    if (!P.ele) continue;
    const step = Math.max(1, Math.ceil(P.n / per));
    const idx = [];
    for (let i = 0; i < P.n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== P.n - 1) idx.push(P.n - 1);
    const kx = M_PER_DEG * Math.cos(toRad(P.lat[0])), half = 7;
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1], b = idx[k];
      if (P.seg[a] !== P.seg[b]) continue;
      const dx = (P.lon[b] - P.lon[a]) * kx, dy = (P.lat[b] - P.lat[a]) * M_PER_DEG;
      const L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const ox = ((-dy / L) * half) / kx, oy = ((dx / L) * half) / M_PER_DEG;
      const h = Math.max(2, (P.ele[a] + P.ele[b]) / 2 - floor);
      feats.push({ type: 'Feature', properties: { id: r.id, c: r._color, h }, geometry: { type: 'Polygon', coordinates: [[[P.lon[a] + ox, P.lat[a] + oy], [P.lon[b] + ox, P.lat[b] + oy], [P.lon[b] - ox, P.lat[b] - oy], [P.lon[a] - ox, P.lat[a] - oy], [P.lon[a] + ox, P.lat[a] + oy]]] } });
    }
  }
  const C = mapColors(isDark());
  for (const p of peaks) {
    if (p.e == null) continue;
    const kx = M_PER_DEG * Math.cos(toRad(p.lat)), rr = 16, ring = [];
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * 2 * Math.PI; ring.push([p.lon + (Math.cos(a) * rr) / kx, p.lat + (Math.sin(a) * rr) / M_PER_DEG]); }
    feats.push({ type: 'Feature', properties: { id: 'p:' + p.id, c: p.st === 'climbed' ? C.summit : C.near, h: Math.max(4, p.e - floor + 35) }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

/* ---------- MapLibre ---------- */
class MLView {
  constructor(el) {
    this.el = el; this.hoverId = null; this.pop = null; this.dark = isDark();
    this.basemap = 'esquema'; this.three = false; this.walls = false; this.dem = false; this.vis = []; this.peaks = [];
  }
  layers(C) {
    const hover = ['boolean', ['feature-state', 'hover'], false];
    const lw = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 5, a, 10, b, 15, c];
    const eleText = ['case', ['has', 'e'], ['format', ['get', 'n'], {}, '  ', {}, ['to-string', ['get', 'e']], { 'text-font': ['literal', ['Noto Sans Italic']], 'font-scale': 0.92 }], ['get', 'n']];
    const vis = (on) => ({ visibility: on ? 'visible' : 'none' });
    const raster = Object.keys(TILES).map((k) => ({ id: 'r-' + k, type: 'raster', source: 'r-' + k, layout: vis(false), paint: { 'raster-fade-duration': 150 } }));
    return [
      { id: 'bg', type: 'background', paint: { 'background-color': C.sea } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': C.land } },
      { id: 'sierras-fill', type: 'fill', source: 'sierras', paint: { 'fill-color': C.sierra, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 0.5] } },
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': C.water } },
      { id: 'rivers', type: 'line', source: 'rivers', paint: { 'line-color': C.river, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1.1, 13, 2] } },
      { id: 'provinces', type: 'line', source: 'provinces', minzoom: 5, paint: { 'line-color': C.admin, 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'borders', type: 'line', source: 'borders', paint: { 'line-color': C.border, 'line-width': 1.3, 'line-dasharray': [5, 2, 1, 2] } },
      { id: 'roads', type: 'line', source: 'roads', minzoom: 6, paint: { 'line-color': C.road, 'line-width': ['match', ['get', 't'], 1, 1.5, 0.8] } },
      { id: 'sierras-line', type: 'line', source: 'sierras', minzoom: 6, paint: { 'line-color': C.sierraLine, 'line-width': 0.9, 'line-dasharray': [2, 2] } },
      ...raster,
      { id: 'sierra-hl', type: 'line', source: 'sierrahl', paint: { 'line-color': C.summit, 'line-width': 2.2, 'line-opacity': 0.85, 'line-dasharray': [3, 1.5] } },
      { id: 'places-dot', type: 'circle', source: 'places', minzoom: 5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.8, 10, 3], 'circle-color': C.place, 'circle-stroke-color': C.halo, 'circle-stroke-width': 1 } },
      { id: 'places-label', type: 'symbol', source: 'places', minzoom: 5, layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 10, 13], 'text-anchor': 'left', 'text-offset': [0.5, 0], 'symbol-sort-key': ['get', 'r'], 'text-optional': true }, paint: { 'text-color': C.place, 'text-halo-color': C.halo, 'text-halo-width': 1.2 } },
      { id: 'sierras-label', type: 'symbol', source: 'sierraPts', minzoom: 6.5, maxzoom: 12.5, layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6.5, 11, 10, 14], 'text-max-width': 9, 'symbol-sort-key': ['-', 0, ['get', 'a']], 'text-letter-spacing': 0.03 }, paint: { 'text-color': C.sierraText, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
      { id: 'allpeaks', type: 'symbol', source: 'allpeaks', minzoom: 10, layout: { 'icon-image': 'v-osm', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.7, 14, 1], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
      { id: 'allpeaks-label', type: 'symbol', source: 'allpeaks', minzoom: 12, layout: { 'text-field': eleText, 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 9, 'text-optional': true }, paint: { 'text-color': C.osmText, 'text-halo-color': C.halo, 'text-halo-width': 1.3 } },
      { id: 'tracks-casing', type: 'line', source: 'tracks', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': C.casing, 'line-opacity': 0.85, 'line-width': lw(3.2, 5.5, 9) } },
      { id: 'tracks', type: 'line', source: 'tracks', filter: ['in', ['get', 'id'], ['literal', []]], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', hover, 3.2, 1.7], 10, ['case', hover, 5, 3], 15, ['case', hover, 8, 5.2]] } },
      { id: 'tracks-sel-casing', type: 'line', source: 'tracks', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': C.ink, 'line-width': lw(6, 8.5, 13) } },
      { id: 'tracks-sel', type: 'line', source: 'tracks', filter: ['==', ['get', 'id'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': lw(3.4, 5, 8) } },
      { id: 'walls', type: 'fill-extrusion', source: 'walls', layout: vis(false), paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.88 } },
      { id: 'cursor', type: 'circle', source: 'cursor', paint: { 'circle-radius': 6, 'circle-color': C.cursor, 'circle-stroke-color': C.halo, 'circle-stroke-width': 2 } },
      { id: 'peak-sel', type: 'circle', source: 'peaksel', paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-color': C.ink, 'circle-stroke-width': 2 } },
      { id: 'mypeaks', type: 'symbol', source: 'mypeaks', layout: { 'icon-image': ['match', ['get', 'st'], 'climbed', 'v-climbed', 'v-near'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['match', ['get', 'st'], 'climbed', 2, 1] } },
      { id: 'mypeaks-label', type: 'symbol', source: 'mypeaks', minzoom: 9, layout: { 'text-field': eleText, 'text-font': ['Noto Sans Medium'], 'text-size': 12.5, 'text-anchor': 'left', 'text-offset': [0.95, 0], 'text-max-width': 12, 'text-optional': true }, paint: { 'text-color': C.ink, 'text-halo-color': C.halo, 'text-halo-width': 1.6 } },
    ];
  }
  style() {
    const B = Ref.base;
    const gj = (data, extra = {}) => ({ type: 'geojson', data, ...extra });
    const sources = {
      land: gj(B.land, { maxzoom: 10 }), lakes: gj(B.lakes, { maxzoom: 10 }), rivers: gj(B.rivers, { maxzoom: 10 }),
      provinces: gj(B.provinces, { maxzoom: 10 }), borders: gj(B.borders, { maxzoom: 10 }), roads: gj(B.roads, { maxzoom: 10 }),
      places: gj(B.places), sierras: gj(Ref.sierraGeo, { maxzoom: 11 }), sierraPts: gj(Ref.sierraPts),
      allpeaks: gj(EMPTY_FC, { maxzoom: 13 }), tracks: gj(EMPTY_FC, { promoteId: 'id', maxzoom: 17, tolerance: 0.3 }),
      mypeaks: gj(EMPTY_FC), walls: gj(EMPTY_FC, { maxzoom: 15 }), cursor: gj(EMPTY_FC), peaksel: gj(EMPTY_FC),
      sierrahl: gj(EMPTY_FC),
    };
    for (const [k, t] of Object.entries(TILES)) sources['r-' + k] = { type: 'raster', tiles: [t.url], tileSize: 256, maxzoom: t.max, attribution: t.attr };
    return { version: 8, glyphs: 'ccglyphs://{fontstack}/{range}', sources, layers: this.layers(mapColors(this.dark)) };
  }
  async init() {
    const ml = window.maplibregl;
    if (!MLView.proto) { ml.addProtocol('ccglyphs', glyphLoader); MLView.proto = true; }
    this.map = new ml.Map({
      container: this.el, style: this.style(), center: [-3.7, 40.2], zoom: 5, minZoom: 2.5, maxZoom: 18.5, maxPitch: 78,
      attributionControl: false, fadeDuration: 150,
    });
    const m = this.map;
    m.addControl(new ml.AttributionControl({ compact: true, customAttribution: 'Cumbres © colaboradores de OpenStreetMap (ODbL), sierras GMBA (CC BY 4.0), Natural Earth' }), 'bottom-right');
    m.addControl(new ml.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.addControl(new ml.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('el mapa no terminó de cargar')), 15000);
      m.once('load', () => { clearTimeout(t); res(); });
    });
    m.on('error', (e) => {
      const msg = e && e.error && e.error.message;
      if (e && (e.sourceId === 'dem' || e.sourceId === 'demhs')) {
        this.demErrors = (this.demErrors || 0) + 1;
        if (this.demErrors >= 6 && this.demKind === 'mapterhorn' && Net.dem === 'mapterhorn') {
          Net.dem = 'aws';
          if (this.three && this.dem) { try { this.set3D(true, 'aws'); } catch (err) { console.warn(err); } }
          MapCtl.updateControls();
          UI.toast('El relieve de 2 m no responde ahora mismo: uso el de 30 m.', { timeout: 7000 });
        }
        return;
      }
      if (msg && !/tile|fetch|load|Failed|NetworkError|Unauthorized|CORS|image/i.test(msg)) { console.warn('mapa:', msg); MapCtl.lastError = msg; }
    });
    m.on('webglcontextlost', () => {
      MapCtl.lastError = 'la tarjeta gráfica reinició el mapa';
      if (MapCtl.hd) { MapCtl.hd = false; try { localStorage.setItem('cc-hd', '0'); } catch {} }
      UI.toast('La tarjeta gráfica ha reiniciado el mapa. He quitado el modo HD; si no se recupera, recarga la página.', { err: true, timeout: 10000 });
    });
    this.images();
    this.bind();
    m.getSource('allpeaks').setData(allPeaksFC());
  }
  images() {
    const C = mapColors(this.dark), m = this.map;
    for (const k of ['climbed', 'near', 'osm', 'todo']) {
      const { data, pr } = vertexBitmap(k, C);
      if (m.hasImage('v-' + k)) m.removeImage('v-' + k);
      m.addImage('v-' + k, data, { pixelRatio: pr });
    }
  }
  bind() {
    const m = this.map;
    // Al inclinar el mapa con el ratón (botón derecho o Ctrl) o con dos dedos, se activa el 3D sin mover la cámara
    m.on('pitch', (e) => { if (e.originalEvent && !MapCtl.is3D && m.getPitch() > 6) MapCtl.auto3D(); });
    const clickable = ['mypeaks', 'mypeaks-label', 'tracks', 'tracks-sel', 'walls', 'plan-pts', 'reto-pts', 'reto-lbl', 'pois-ic', 'pois-ic-f', 'pois-ic-p', 'pois-lbl', 'allpeaks', 'allpeaks-label'];
    for (const ev of ['mousedown', 'touchstart', 'wheel']) m.on(ev, () => { if (this.orbiting) { this.stopOrbit(); MapCtl.updateControls(); } });
    for (const ev of ['mousedown', 'touchstart']) m.on(ev, () => { if (this.fly && !this.fly.paused) this.flyPause(true); });
    m.on('click', (e) => {
      if (S.ui.placing) { MapCtl.emit('place', { lat: e.lngLat.lat, lon: e.lngLat.lng }); return; }
      const p = 7;
      const layers = clickable.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none');
      const feats = m.queryRenderedFeatures([[e.point.x - p, e.point.y - p], [e.point.x + p, e.point.y + p]], { layers });
      const ll = [e.lngLat.lng, e.lngLat.lat];
      const pl = feats.find((f) => f.layer.id === 'plan-pts');
      if (pl) { MapCtl.popup(pl.geometry.coordinates, `<div class="pp"><b>${esc(pl.properties.n || pl.properties.lbl)}</b></div>`); return; }
      const pk = feats.find((f) => f.layer.id === 'mypeaks' || f.layer.id === 'mypeaks-label') || feats.find((f) => f.layer.id === 'walls' && String(f.properties.id).startsWith('p:'));
      if (pk) { MapCtl.emit('peak', { id: String(pk.properties.id).replace(/^p:/, ''), lngLat: ll }); return; }
      const tr = feats.filter((f) => f.layer.id.startsWith('tracks') || f.layer.id === 'walls');
      if (tr.length) { MapCtl.emit('routes', { ids: [...new Set(tr.map((f) => f.properties.id))], lngLat: ll }); return; }
      const po = feats.find((f) => f.layer.id.startsWith('pois-'));
      if (po) { MapCtl.emit('poi', { props: po.properties, lngLat: po.geometry.coordinates }); return; }
      const op = feats.find((f) => f.layer.id === 'reto-pts' || f.layer.id === 'reto-lbl') || feats.find((f) => f.layer.id === 'allpeaks' || f.layer.id === 'allpeaks-label');
      if (op) { MapCtl.emit('osmpeak', { props: op.properties, lngLat: op.geometry.coordinates }); return; }
      const near = this.nearestPeak(e.point, 24);
      if (near) MapCtl.emit('osmpeak', { props: { id: near.id, n: near.name, e: near.ele }, lngLat: [near.lon, near.lat] });
    });
    const cur = (v) => { m.getCanvas().style.cursor = v; };
    m.on('mousemove', 'tracks', (e) => {
      const id = e.features && e.features[0] && e.features[0].properties.id;
      if (id !== this.hoverId) { this.hover(this.hoverId, false); this.hoverId = id; this.hover(id, true); }
      if (!S.ui.placing) cur('pointer');
    });
    m.on('mouseleave', 'tracks', () => { this.hover(this.hoverId, false); this.hoverId = null; cur(''); });
    for (const l of ['mypeaks', 'allpeaks']) {
      m.on('mouseenter', l, () => { if (!S.ui.placing) cur('pointer'); });
      m.on('mouseleave', l, () => cur(''));
    }
  }
  hover(id, v) { if (id) { try { this.map.setFeatureState({ source: 'tracks', id }, { hover: v }); } catch {} } }
  /** Cumbre más cercana a un punto de la pantalla (sirve también sobre el mapa del IGN, donde la cima está en la imagen). */
  nearestPeak(pt, px) {
    const m = this.map;
    if (m.getZoom() < 9.5 || !Ref.ready) return null;
    const a = m.unproject([pt.x - px, pt.y - px]), b = m.unproject([pt.x + px, pt.y + px]);
    return nearestPeakIn(Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat), (lon, lat) => { const q = m.project([lon, lat]); return (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2; }, px * px);
  }
  setFocus(f) {
    if (this.focusMk) { this.focusMk.remove(); this.focusMk = null; }
    if (!f) return;
    const el = focusElement(f);
    this.focusMk = new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([f.lon, f.lat]).addTo(this.map);
  }
  centerOn(lat, lon, z) { this.map.easeTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), z), duration: 900 }); }
  highlightSierra(fc) { this.map.getSource('sierrahl').setData(fc || EMPTY_FC); }
  rotateBy(d) { this.stopOrbit(); this.map.easeTo({ bearing: this.map.getBearing() + d, duration: 650 }); }
  tiltBy(d) { this.stopOrbit(); this.map.easeTo({ pitch: clamp(this.map.getPitch() + d, 0, 78), duration: 500 }); }
  startOrbit() {
    this.stopOrbit();
    this.orbiting = true;
    let last = performance.now();
    const step = (t) => {
      if (!this.orbiting) return;
      this.map.setBearing(this.map.getBearing() + Math.min(64, t - last) * 0.006);
      last = t;
      this.orbitRaf = requestAnimationFrame(step);
    };
    this.orbitRaf = requestAnimationFrame(step);
  }
  stopOrbit() { this.orbiting = false; if (this.orbitRaf) cancelAnimationFrame(this.orbitRaf); this.orbitRaf = null; }
  ensureDem(kind) {
    const m = this.map;
    if (this.demKind === kind) return;
    if (m.getTerrain()) m.setTerrain(null);
    if (m.getLayer('hillshade')) m.removeLayer('hillshade');
    for (const id of ['dem', 'demhs']) if (m.getSource(id)) m.removeSource(id);
    const d = DEMS[kind];
    const def = { type: 'raster-dem', tiles: [d.url], tileSize: d.tileSize, maxzoom: d.maxzoom, encoding: 'terrarium', attribution: d.attr };
    m.addSource('dem', def);
    m.addSource('demhs', { ...def });
    m.addLayer({ id: 'hillshade', type: 'hillshade', source: 'demhs', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': mapColors(this.dark).hill } }, 'sierra-hl');
    this.demKind = kind;
  }
  setExag(v) { if (this.dem) { this.map.setTerrain({ source: 'dem', exaggeration: v }); this.applyMesh(); } }
  /** Densidad de la malla 3D: MapLibre usa 128 divisiones por tesela; en HD, 240 (con 2 m de datos, ~2 m por vértice a zoom 16). */
  applyMesh() {
    const t = this.map.terrain;
    if (!t || typeof t.meshSize !== 'number' || !t._meshCache) return false;
    const want = MapCtl.hd ? 240 : 128;
    if (t.meshSize !== want) {
      t.meshSize = want;
      for (const k in t._meshCache) { try { t._meshCache[k].destroy(); } catch {} }
      t._meshCache = {};
      this.map.triggerRepaint();
    }
    return true;
  }
  /* «Volar la ruta»: la cámara recorre el track en 3D, por detrás y mirando hacia delante */
  startFly(r) {
    this.stopFly(); this.stopOrbit();
    const P = r._P, total = P.cum[P.n - 1];
    if (!(total > 50)) return false;
    const step = Math.max(8, total / 4000), pts = [];
    let j = 0;
    for (let d = 0; d <= total + 1e-6; d += step) {
      while (j < P.n - 2 && P.cum[j + 1] < d) j++;
      const span = P.cum[j + 1] - P.cum[j], f = span > 0 ? clamp((d - P.cum[j]) / span, 0, 1) : 0;
      pts.push([P.lon[j] + f * (P.lon[j + 1] - P.lon[j]), P.lat[j] + f * (P.lat[j + 1] - P.lat[j]), Math.min(total, d)]);
    }
    const ahead = Math.max(1, Math.round(220 / step));
    const brg = (k) => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + ahead)];
      return (Math.atan2((b[0] - a[0]) * Math.cos(toRad(a[1])), b[1] - a[1]) * 180) / Math.PI;
    };
    const F = (this.fly = { r, pts, brg, total, scale: routeScale(r), dur: clamp(total * 7, 40000, 180000), elapsed: 0, speed: 1, paused: false, bearing: brg(0), last: 0, raf: 0 });
    const el = document.createElement('div');
    el.className = 'fly-mk';
    el.style.setProperty('--c', r._color);
    F.mk = new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([pts[0][0], pts[0][1]]).addTo(this.map);
    this.map.easeTo({ center: [pts[0][0], pts[0][1]], zoom: Math.max(15.4, this.map.getZoom()), pitch: 68, bearing: F.bearing, duration: 1400 });
    F.wait = setTimeout(() => this.flyRun(F), 1450);
    MapCtl.flyChanged();
    return true;
  }
  flyApply(F, dt) {
    const u = F.elapsed / F.dur, fk = u * (F.pts.length - 1), k = Math.min(F.pts.length - 1, Math.floor(fk)), f = fk - k;
    const a = F.pts[k], b = F.pts[Math.min(F.pts.length - 1, k + 1)];
    F.lon = a[0] + f * (b[0] - a[0]); F.lat = a[1] + f * (b[1] - a[1]); F.d = a[2] + f * (b[2] - a[2]);
    const delta = ((F.brg(k) - F.bearing + 540) % 360) - 180;
    F.bearing += dt == null ? delta : delta * Math.min(1, (dt * F.speed) / 1800);
    this.map.jumpTo({ center: [F.lon, F.lat], bearing: F.bearing });
    F.mk.setLngLat([F.lon, F.lat]);
    MapCtl.flyProgress(F);
  }
  flyRun(F) {
    if (this.fly !== F) return;
    F.last = performance.now();
    const frame = (t) => {
      if (this.fly !== F) return;
      const dt = Math.min(100, t - F.last);
      F.last = t;
      if (!F.paused) {
        F.elapsed = Math.min(F.dur, F.elapsed + dt * F.speed);
        this.flyApply(F, dt);
        if (F.elapsed >= F.dur) { F.paused = true; F.ended = true; MapCtl.flyChanged(); }
      }
      F.raf = requestAnimationFrame(frame);
    };
    F.raf = requestAnimationFrame(frame);
  }
  flyPause(p) {
    const F = this.fly;
    if (!F) return;
    if (!p && F.ended) { F.elapsed = 0; F.ended = false; }
    F.paused = p;
    MapCtl.flyChanged();
  }
  flySeek(u) {
    const F = this.fly;
    if (!F) return;
    F.elapsed = clamp(u, 0, 1) * F.dur;
    F.ended = F.elapsed >= F.dur;
    this.flyApply(F, null);
    MapCtl.flyChanged();
  }
  stopFly() {
    const F = this.fly;
    if (!F) return;
    clearTimeout(F.wait);
    cancelAnimationFrame(F.raf);
    if (F.mk) F.mk.remove();
    this.fly = null;
    MapCtl.flyChanged();
  }
  setRoutes(list) {
    this.map.getSource('tracks').setData({ type: 'FeatureCollection', features: list.map((r) => ({ type: 'Feature', properties: { id: r.id, c: r._color }, geometry: trackGeometry(r._P) })) });
  }
  setVisible(routes) {
    this.vis = routes;
    const f = ['in', ['get', 'id'], ['literal', routes.map((r) => r.id)]];
    this.map.setFilter('tracks', f);
    this.map.setFilter('tracks-casing', f);
    if (this.walls) this.refreshWalls();
  }
  setPeaks(peaks) {
    this.peaks = peaks;
    this.map.getSource('mypeaks').setData({
      type: 'FeatureCollection',
      features: peaks.map((p) => {
        const props = { id: p.id, n: p.n, st: p.st, k: p.k };
        if (p.e != null) props.e = Math.round(p.e);
        return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } };
      }),
    });
    if (this.walls) this.refreshWalls();
  }
  refreshWalls() { this.map.getSource('walls').setData(wallsFC(this.vis, this.peaks)); }
  select(id) {
    const f = ['==', ['get', 'id'], id || ''];
    this.map.setFilter('tracks-sel', f);
    this.map.setFilter('tracks-sel-casing', f);
  }
  selectPeak(p) {
    this.map.getSource('peaksel').setData(p ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }] } : EMPTY_FC);
  }
  setPois(items) {
    const m = this.map;
    const fc = { type: 'FeatureCollection', features: (items || []).map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { id: p.id, k: p.k, n: p.n || '', e: p.e || 0, np: p.np || 0, r: POI_INFO[p.k].rank } })) };
    if (!m.getSource('pois')) {
      const pr = Math.min(2, Math.ceil(window.devicePixelRatio || 1));
      for (const k of POI_MAP_KINDS) if (!m.hasImage('p-' + k)) m.addImage('p-' + k, poiImage(k), { pixelRatio: pr });
      m.addSource('pois', { type: 'geojson', data: fc });
      const before = m.getLayer('reto-pts') ? 'reto-pts' : m.getLayer('mypeaks') ? 'mypeaks' : undefined;
      const icon = { 'icon-image': ['concat', 'p-', ['get', 'k']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 10.5, 0.75, 14, 1], 'symbol-sort-key': ['get', 'r'], 'icon-padding': 1 };
      m.addLayer({ id: 'pois-ic', type: 'symbol', source: 'pois', minzoom: 10.5, filter: ['!', ['in', ['get', 'k'], ['literal', ['fuente', 'parking']]]], layout: icon }, before);
      m.addLayer({ id: 'pois-ic-p', type: 'symbol', source: 'pois', minzoom: 14, filter: ['==', ['get', 'k'], 'parking'], layout: icon }, before);
      m.addLayer({ id: 'pois-ic-f', type: 'symbol', source: 'pois', minzoom: 13, filter: ['==', ['get', 'k'], 'fuente'], layout: icon }, before);
      m.addLayer({ id: 'pois-lbl', type: 'symbol', source: 'pois', minzoom: 12, filter: ['all', ['!', ['in', ['get', 'k'], ['literal', ['fuente', 'parking']]]], ['!=', ['get', 'n'], '']],
        layout: { 'text-field': ['get', 'n'], 'text-font': ['match', ['get', 'k'], 'laguna', ['literal', ['Noto Sans Italic']], ['literal', ['Noto Sans Medium']]], 'text-size': 11.5, 'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-optional': true, 'symbol-sort-key': ['get', 'r'] },
        paint: { 'text-color': ['match', ['get', 'k'], 'laguna', '#1f5f92', 'cascada', '#1f5f92', 'collado', '#4a443d', '#7a3d1c'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } }, before);
    } else m.getSource('pois').setData(fc);
  }
  setPlan(p) {
    const m = this.map;
    const L = { type: 'FeatureCollection', features: p ? p.lines : [] }, Pt = { type: 'FeatureCollection', features: p ? p.pts : [] };
    if (!m.getSource('plan-l')) {
      m.addSource('plan-l', { type: 'geojson', data: L });
      m.addSource('plan-p', { type: 'geojson', data: Pt });
      m.addLayer({ id: 'plan-casing', type: 'line', source: 'plan-l', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 } });
      m.addLayer({ id: 'plan-on', type: 'line', source: 'plan-l', filter: ['!', ['get', 'off']], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'col'], 'line-width': 4 } });
      m.addLayer({ id: 'plan-off', type: 'line', source: 'plan-l', filter: ['get', 'off'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['get', 'col'], 'line-width': 3.5, 'line-dasharray': [1.4, 1.2] } });
      m.addLayer({ id: 'plan-pts', type: 'circle', source: 'plan-p', paint: { 'circle-radius': ['match', ['get', 't'], 'peak', 9, 'water', 5, 8], 'circle-color': ['get', 'col'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'plan-num', type: 'symbol', source: 'plan-p', filter: ['==', ['get', 't'], 'peak'], layout: { 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': '#ffffff' } });
      m.addLayer({ id: 'plan-lbl', type: 'symbol', source: 'plan-p', filter: ['any', ['==', ['get', 't'], 'night'], ['==', ['get', 't'], 'start']], layout: { 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true }, paint: { 'text-color': '#1e2622', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } });
    } else { m.getSource('plan-l').setData(L); m.getSource('plan-p').setData(Pt); }
  }
  setTrails(on) {
    const m = this.map;
    if (on && !m.getSource('r-senderos')) {
      m.addSource('r-senderos', { type: 'raster', tiles: [OVERLAYS.senderos.url], tileSize: 256, maxzoom: OVERLAYS.senderos.max, attribution: OVERLAYS.senderos.attr });
      m.addLayer({ id: 'r-senderos', type: 'raster', source: 'r-senderos', paint: { 'raster-opacity': 0.92, 'raster-fade-duration': 150 } }, 'sierra-hl');
    }
    if (m.getLayer('r-senderos')) m.setLayoutProperty('r-senderos', 'visibility', on ? 'visible' : 'none');
  }
  setReto(items) {
    const m = this.map, C = mapColors(isDark());
    const fc = { type: 'FeatureCollection', features: (items || []).map((it) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
      properties: { id: it.id, n: it.name, e: it.ele, st: it.st, lbl: (it.tag ? it.tag + ': ' : '') + it.name + (it.ele != null ? ' ' + it.ele : '') } })) };
    if (!m.getSource('reto')) {
      m.addSource('reto', { type: 'geojson', data: fc });
      m.addLayer({ id: 'reto-pts', type: 'symbol', source: 'reto', layout: { 'icon-image': ['match', ['get', 'st'], 'climbed', 'v-climbed', 'near', 'v-near', 'v-todo'], 'icon-allow-overlap': true, 'symbol-sort-key': ['match', ['get', 'st'], 'climbed', 1, 0] } }, 'mypeaks');
      m.addLayer({ id: 'reto-lbl', type: 'symbol', source: 'reto', minzoom: 9.5, layout: { 'text-field': ['get', 'lbl'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': C.label || '#1e2622', 'text-halo-color': C.halo, 'text-halo-width': 1.6 } }, 'mypeaks');
    } else m.getSource('reto').setData(fc);
    for (const l of ['reto-pts', 'reto-lbl']) m.setLayoutProperty(l, 'visibility', items && items.length ? 'visible' : 'none');
  }
  fit(b, animate = true) {
    this.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 70, bottom: 50, left: 40, right: 40 }, maxZoom: 14.5, duration: animate ? 800 : 0, pitch: this.map.getPitch() });
  }
  home(animate) { this.fit(SPAIN, animate); }
  flyTo(lat, lon, z) { this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), z), speed: 1.4 }); }
  setCursor(lat, lon) {
    this.map.getSource('cursor').setData(lat == null ? EMPTY_FC : { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] });
  }
  popup(ll, html) {
    this.closePopup();
    this.pop = new window.maplibregl.Popup({ maxWidth: '300px', offset: 12, focusAfterOpen: false }).setLngLat(ll).setHTML(html).addTo(this.map);
  }
  closePopup() { if (this.pop) { this.pop.remove(); this.pop = null; } }
  setBasemap(id) {
    this.basemap = id;
    const m = this.map;
    for (const k of Object.keys(TILES)) m.setLayoutProperty('r-' + k, 'visibility', k === id ? 'visible' : 'none');
    for (const l of BASE_LAYERS) m.setLayoutProperty(l, 'visibility', id === 'esquema' ? 'visible' : 'none');
  }
  set3D(on, dem, keep = false) {
    const m = this.map;
    this.three = on;
    this.dem = on && dem ? dem : false;
    if (!on) { this.stopOrbit(); this.stopFly(); }
    if (this.dem) {
      this.ensureDem(this.dem);
      m.setTerrain({ source: 'dem', exaggeration: MapCtl.exag });
      this.meshTunable = this.applyMesh();
      m.setLayoutProperty('hillshade', 'visibility', 'visible');
    } else {
      if (m.getTerrain()) m.setTerrain(null);
      if (m.getLayer('hillshade')) m.setLayoutProperty('hillshade', 'visibility', 'none');
    }
    this.walls = on && !dem;
    m.setLayoutProperty('walls', 'visibility', this.walls ? 'visible' : 'none');
    if (this.walls) this.refreshWalls(); else m.getSource('walls').setData(EMPTY_FC);
    m.setPaintProperty('tracks', 'line-opacity', this.walls ? 0.4 : 1);
    m.setPaintProperty('tracks-casing', 'line-opacity', this.walls ? 0.3 : 0.85);
    if (!keep) m.easeTo({ pitch: on ? 62 : 0, bearing: on ? (m.getBearing() || -18) : 0, duration: 900 });
  }
  theme() {
    this.dark = isDark();
    const m = this.map;
    for (const l of this.layers(mapColors(this.dark))) {
      if (!m.getLayer(l.id)) continue;
      for (const [k, v] of Object.entries(l.paint || {})) { try { m.setPaintProperty(l.id, k, v); } catch {} }
    }
    if (m.getLayer('hillshade')) m.setPaintProperty('hillshade', 'hillshade-shadow-color', mapColors(this.dark).hill);
    this.images();
    if (this.three) this.set3D(true, this.dem);
  }
  resize() { this.map.resize(); }
  destroy() { try { this.map.remove(); } catch {} }
}

/* ---------- Controlador del mapa ---------- */
/** Cumbre más cercana dentro de un rectángulo, según una distancia en píxeles. */
function nearestPeakIn(w, s, e, n, dist2, max2) {
  let best = null, bd = max2;
  for (const i of Ref.query(w, s, e, n)) { const d = dist2(Ref.lon[i], Ref.lat[i]); if (d <= bd) { bd = d; best = 'osm:' + Ref.ids[i]; } }
  for (const [id, c] of Object.entries(S.data.customPeaks)) {
    if (c.lon < w || c.lon > e || c.lat < s || c.lat > n) continue;
    const d = dist2(c.lon, c.lat); if (d <= bd) { bd = d; best = id; }
  }
  return best ? peakInfo(best) : null;
}
/** Marca persistente de la cumbre elegida: anillo y rótulo con nombre y cota. */
function focusElement(f) {
  const el = document.createElement('div');
  el.className = 'focus-mk';
  el.innerHTML = `<span class="ring"></span><span class="lbl">${esc(f.name)}${f.ele != null ? `<i>${fmt.num(f.ele)}</i>` : ''}</span>`;
  el.querySelector('.lbl').addEventListener('click', (ev) => { ev.stopPropagation(); MapCtl.focusPeak(f.id, { fly: false }); });
  return el;
}
const MapCtl = {
  view: null, kind: '', handlers: {}, basemap: 'esquema', userBasemap: false, is3D: false, focus: null, exag: 1.3,
  hd: (() => { try { return localStorage.getItem('cc-hd') === '1'; } catch { return false; } })(),
  why: '',
  readyP: null, netDone: false, noteOff: false,
  on(evt, fn) { this.handlers[evt] = fn; },
  emit(evt, p) { const fn = this.handlers[evt]; if (fn) fn(p); },
  whenReady() { return this.readyP || Promise.resolve(false); },
  init(refP) {
    try { this.noteOff = localStorage.getItem('cc-note-off') === '1'; } catch { this.noteOff = false; }
    this.readyP = (async () => {
      const el = $('#map');
      const netP = probeNetwork().catch(() => {});
      try { await refP; } catch { return false; }
      let v = null;
      const gl = hasWebGL(), wk = gl && (await probeWorker());
      if (!gl) this.why = 'este navegador no tiene WebGL activo (revisa que la aceleración por hardware esté encendida)';
      else if (!wk) this.why = 'esta vista no permite los procesos en segundo plano que necesita el 3D';
      if (gl && wk) {
        try {
          await loadScriptAny(CDN.maplibre, () => !!window.maplibregl);
          await Glyphs.load();
          v = new MLView(el);
          await v.init();
          this.view = v; this.kind = 'maplibre';
        } catch (e) {
          console.warn('MapLibre no disponible:', e);
          this.why = 'el mapa 3D no arrancó (' + ((e && e.message) || e) + ')';
          if (v) v.destroy();
          el.innerHTML = '';
        }
      }
      if (!this.view) el.innerHTML = `<div class="map-msg">No se pudo cargar el mapa: ${esc(this.why || 'error desconocido')}. El cuaderno sigue funcionando sin él.</div>`;
      this.updateControls();
      netP.then(() => this.onNetwork());
      try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (this.view) { this.view.theme(); this.syncAll(); } }); } catch {}
      return !!this.view;
    })();
    return this.readyP;
  },
  onNetwork() {
    this.netDone = true;
    this.updateControls();
    if (this.view && this.trails && Net.trails) this.view.setTrails(true);
    if (this.view && !this._mvBound) { this._mvBound = true; this.view.map.on('moveend', () => this.onMove()); }
    this.onMove();
    if (this.view && !this.userBasemap) {
      const pick = Net.tiles['ign-topo'] ? 'ign-topo' : Net.tiles.osm ? 'osm' : null;
      if (pick) { this.basemap = pick; this.view.setBasemap(pick); this.updateControls(); }
    }
    if (!S.ui.placing) this.restoreNote();
  },
  onMove() { clearTimeout(this._mvT); this._mvT = setTimeout(() => Pois.refresh(), 500); },
  trails: (() => { try { return localStorage.getItem('cc-senderos') === '1'; } catch { return false; } })(),
  toggleTrails() {
    this.trails = !this.trails;
    try { localStorage.setItem('cc-senderos', this.trails ? '1' : '0'); } catch {}
    if (this.view) this.view.setTrails(this.trails && !!Net.trails);
    this.updateControls();
  },
  showReto(items, fit = false) {
    this.retoItems = items || null;
    if (!this.view) return;
    this.view.setReto(items || []);
    if (fit && items && items.length) {
      let w = 180, s = 90, e = -180, n = -90;
      for (const it of items) { w = Math.min(w, it.lon); e = Math.max(e, it.lon); s = Math.min(s, it.lat); n = Math.max(n, it.lat); }
      this.view.fit([w - 0.02, s - 0.02, e + 0.02, n + 0.02]);
    }
  },
  updateControls() {
    const bt = $('#btnTrails');
    if (bt) { bt.hidden = !(this.view && Net.trails); bt.setAttribute('aria-pressed', String(!!this.trails)); }
    const bo = $('#btnOffline');
    if (bo) bo.hidden = !(this.view && Offline.available());
    const bp = $('#btnPois');
    if (bp) { bp.hidden = !(this.view && Pois.available()); bp.setAttribute('aria-pressed', String(!!Pois.on)); }
    $$('#basemaps button').forEach((b) => {
      const k = b.dataset.bm, ok = k === 'esquema' || !!Net.tiles[k];
      b.disabled = !ok || !this.view;
      b.setAttribute('aria-pressed', String(k === this.basemap));
      b.title = ok ? '' : 'No disponible en esta vista';
    });
    const r3 = $('#rot3d');
    if (r3) {
      r3.hidden = !(this.kind === 'maplibre' && this.is3D);
      const ob = r3.querySelector('[data-orbit]');
      ob.setAttribute('aria-pressed', String(!!(this.view && this.view.orbiting)));
      const ex = r3.querySelector('[data-exag]');
      ex.hidden = !(this.view && this.view.dem);
      ex.textContent = '×' + String(this.exag).replace('.', ',');
      const hd = r3.querySelector('[data-hd]');
      hd.hidden = !(this.view && this.view.dem && this.view.meshTunable !== false);
      hd.setAttribute('aria-pressed', String(this.hd));
      const lbl = r3.querySelector('.demlbl');
      lbl.hidden = !(this.view && this.view.dem);
      lbl.textContent = this.view && this.view.dem === 'mapterhorn' ? 'Relieve 2 m' : 'Relieve 30 m';
    }
    const b3 = $('#btn3d');
    b3.disabled = !this.view;
    b3.setAttribute('aria-pressed', String(this.is3D));
    b3.title = this.kind !== 'maplibre' ? 'El 3D no está disponible en este navegador' : Net.dem ? 'Vista 3D con relieve' : 'Vista 3D: tus tracks a su altitud real, sin relieve del terreno';
    $('#btnFit').disabled = !this.view;
  },
  offlineNote() {
    if (!this.netDone || Net.online || this.noteOff) return '';
    return '<b>Sin conexión.</b> Ves el mapa esquemático y las zonas que hayas guardado; con internet se cargan el resto de mapas y el relieve 3D. <button class="link" type="button" data-act="dismiss-note">Entendido</button>';
  },
  note(html) { const el = $('#mapNote'); el.innerHTML = html || ''; el.hidden = !html; },
  restoreNote() { this.note(this.offlineNote()); },
  dismissNote() { this.noteOff = true; try { localStorage.setItem('cc-note-off', '1'); } catch {} this.restoreNote(); },
  syncAll() { if (!this.view) return; this.view.setRoutes([...S.routes.values()]); this.syncVisible(); },
  syncVisible() {
    if (!this.view) return;
    const vis = visibleOnMap();
    this.view.setVisible(vis);
    this.view.setPeaks(mapPeaks(vis));
    if (S.ui.selRoute && !S.routes.has(S.ui.selRoute)) S.ui.selRoute = null;
    this.view.select(S.ui.selRoute);
  },
  fitVisible(animate = true) {
    if (!this.view) return;
    const b = routesBounds(visibleOnMap());
    if (b) this.view.fit(b, animate); else this.view.home(animate);
  },
  fitRoutes(ids) { const b = routesBounds(ids.map((id) => S.routes.get(id))); if (b && this.view) this.view.fit(b, true); },
  selectRoute(id, fit = false) {
    if (!this.view) return;
    this.view.select(id || null);
    if (id && fit) { const r = S.routes.get(id); if (r) this.view.fit(r.bbox, true); }
  },
  selectPeak(id, fly = false) { if (id) this.focusPeak(id, { fly, popup: false }); },
  /** Centra el mapa en una cumbre y la deja marcada hasta elegir otra o quitar la marca. */
  focusPeak(id, { fly = true, popup = true } = {}) {
    if (!this.view) return;
    const m = mountains().get(id);
    const info = (m && m.info) || peakInfo(id);
    if (!info) return;
    this.focus = { id, lat: info.lat, lon: info.lon, name: info.name, ele: info.ele };
    this.view.setFocus(this.focus);
    if (fly) this.view.centerOn(info.lat, info.lon, this.is3D ? 15 : 13.5);
    if (popup) {
      const html = m ? peakPopup(id) : osmPopup({ id, n: info.name, e: info.ele });
      this.view.popup([info.lon, info.lat], html.replace(/<\/div>$/, '<div class="row" style="margin-top:6px"><button class="link" type="button" data-act="clear-focus">Quitar marca</button></div></div>'));
    }
  },
  clearFocus() { this.focus = null; if (this.view) { this.view.setFocus(null); this.view.highlightSierra(null); } },
  focusSierra(name) {
    if (!this.view) return;
    const feats = [];
    Ref.sierras.forEach((s, i) => { if (renameSierra(s.name) === name) feats.push(Ref.sierraGeo.features[i]); });
    if (!feats.length) return;
    let w = 180, so = 90, e = -180, n = -90;
    Ref.sierras.forEach((s, i) => { if (renameSierra(s.name) === name) { w = Math.min(w, s.bbox[0]); so = Math.min(so, s.bbox[1]); e = Math.max(e, s.bbox[2]); n = Math.max(n, s.bbox[3]); } });
    this.view.highlightSierra({ type: 'FeatureCollection', features: feats });
    this.view.fit([w, so, e, n], true);
  },
  centerOn(lat, lon, z) { if (this.view) this.view.centerOn(lat, lon, z); },
  rotate(d) { if (this.kind === 'maplibre') { this.view.rotateBy(d); this.updateControls(); } },
  tilt(d) { if (this.kind === 'maplibre') this.view.tiltBy(d); },
  orbit() {
    if (this.kind !== 'maplibre') return;
    if (this.view.orbiting) this.view.stopOrbit(); else this.view.startOrbit();
    this.updateControls();
  },
  toggleHD() {
    this.hd = !this.hd;
    try { localStorage.setItem('cc-hd', this.hd ? '1' : '0'); } catch {}
    if (this.kind === 'maplibre') {
      try { this.view.applyMesh(); } catch (e) { this.hd = false; UI.toast('No se pudo activar el modo HD: ' + ((e && e.message) || e), { err: true }); }
      if (this.hd) { this.view.map.easeTo({ bearing: this.view.map.getBearing() + 8, duration: 1000 }); this.watchFps(); }
    }
    this.updateControls();
  },
  /** Comprueba que el relieve de 2 m llega en la zona que se está mirando; si no, usa el de 30 m. */
  async checkDem() {
    if (Net.dem !== 'mapterhorn' || this.kind !== 'maplibre') return;
    const m = this.view.map, c = m.getCenter();
    const ok = await probeImage(tileUrlAt(DEMS.mapterhorn.url, c.lng, c.lat, clamp(Math.floor(m.getZoom()), 6, 14)), 8000);
    if (ok || Net.dem !== 'mapterhorn' || !this.is3D) return;
    Net.dem = 'aws';
    try { this.view.set3D(true, 'aws'); } catch (e) { console.warn(e); }
    this.updateControls();
    UI.toast('El relieve de 2 m no responde aquí: uso el de 30 m.', { timeout: 7000 });
  },
  /** Si con HD el mapa va a tirones en este equipo (menos de ~8 fotogramas por segundo en movimiento), lo quita. */
  watchFps() {
    if (this.kind !== 'maplibre' || !this.hd) return;
    const m = this.view.map;
    let n = 0;
    const count = () => { n++; };
    m.on('render', count);
    setTimeout(() => {
      m.off('render', count);
      if (this.hd && this.is3D && n < 8) {
        this.hd = false;
        try { localStorage.setItem('cc-hd', '0'); } catch {}
        try { this.view.applyMesh(); } catch {}
        this.updateControls();
        UI.toast('Con el modo HD el mapa iba a tirones en este equipo, así que lo he quitado.', { timeout: 8000 });
      }
    }, 1000);
  },
  flyRoute(id) {
    const r = S.routes.get(id);
    if (!r || this.kind !== 'maplibre') return;
    this.closePopup();
    if (!this.is3D) this.toggle3D();
    this.view.startFly(r);
  },
  flyCmd(cmd) {
    const F = this.view && this.view.fly;
    if (!F) return;
    if (cmd === 'pause') this.view.flyPause(F.ended ? false : !F.paused);
    else if (cmd === 'speed') { const sp = [1, 2, 4, 0.5]; F.speed = sp[(sp.indexOf(F.speed) + 1) % sp.length]; this.flyChanged(); }
    else if (cmd === 'stop') this.view.stopFly();
  },
  flySeek(u) { if (this.view && this.view.fly) this.view.flySeek(u); },
  flyChanged() {
    const F = this.view && this.view.fly, bar = $('#flybar');
    bar.hidden = !F;
    if (!F) return;
    bar.querySelector('.fb-name').textContent = F.r.name;
    bar.querySelector('[data-fly="pause"]').textContent = F.ended ? 'Repetir' : F.paused ? 'Seguir' : 'Pausa';
    bar.querySelector('[data-fly="speed"]').textContent = '×' + String(F.speed).replace('.', ',');
  },
  flyProgress(F) {
    const bar = $('#flybar');
    bar.querySelector('.fb-prog i').style.width = ((100 * F.elapsed) / F.dur).toFixed(2) + '%';
    const ele = eleAt(F.r._P, F.d);
    bar.querySelector('.fb-km').textContent = `km ${fmt.kmNum(F.d * F.scale)} de ${fmt.kmNum(F.total * F.scale)}${ele != null ? `, ${fmt.m(ele)}` : ''}`;
    UI.profileAt(F.r.id, F.d);
  },
  cycleExag() {
    this.exag = EXAGS[(EXAGS.indexOf(this.exag) + 1) % EXAGS.length];
    if (this.kind === 'maplibre') this.view.setExag(this.exag);
    this.updateControls();
  },
  setCursor(lat, lon) { if (this.view) this.view.setCursor(lat == null ? null : lat, lon); },
  popup(ll, html) { if (this.view && html) this.view.popup(ll, html); },
  closePopup() { if (this.view) this.view.closePopup(); },
  setBasemap(id) { if (!this.view) return; this.basemap = id; this.userBasemap = true; this.view.setBasemap(id); this.updateControls(); },
  auto3D() {
    if (this.is3D || this.kind !== 'maplibre' || !this.view) return;
    this.is3D = true;
    try { this.view.set3D(true, Net.dem, true); this.watchFps(); this.checkDem(); }
    catch (e) { console.warn('3D automático:', e); this.is3D = false; try { this.view.set3D(false, false, true); } catch {} }
    this.updateControls();
  },
  toggle3D() {
    if (this.kind !== 'maplibre') {
      UI.toast(`El 3D no está disponible en este navegador: ${this.why || 'el mapa está en modo básico'}.`, { err: true, timeout: 10000 });
      return;
    }
    this.is3D = !this.is3D;
    try { this.view.set3D(this.is3D, Net.dem); }
    catch (e) {
      console.error('3D:', e);
      this.lastError = (e && e.message) || String(e);
      this.is3D = false;
      try { this.view.set3D(false, false); } catch {}
      UI.toast('No se pudo activar el 3D: ' + this.lastError, { err: true, timeout: 12000 });
      this.updateControls();
      return;
    }
    if (this.is3D) { this.watchFps(); this.checkDem(); }
    let hinted = true;
    try { hinted = localStorage.getItem('cc-3d-hint') === '1'; localStorage.setItem('cc-3d-hint', '1'); } catch {}
    if (this.is3D && !hinted) UI.toast('Para girar: dos dedos en el móvil; en el ordenador, botón derecho (o Ctrl) y arrastrar. También tienes los botones de giro y «Orbitar».', { timeout: 9000 });
    const r = this.is3D && S.ui.selRoute && S.routes.get(S.ui.selRoute);
    if (r) this.view.fit(r.bbox, true);
    this.updateControls();
  },
  resize() { if (this.view) this.view.resize(); },
};
