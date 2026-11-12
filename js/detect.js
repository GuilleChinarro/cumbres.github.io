'use strict';
/* ===================== 4. Detección de cumbres ===================== */
const SEARCH_RADIUS = 1000; // se guardan candidatas hasta 1 km; la clasificación usa los umbrales de Ajustes

/** Cumbres a menos de `radius` m del track. `only`: lista de cumbres concretas a comprobar. */
function detectOnTrack(P, radius = SEARCH_RADIUS, only = null) {
  const { n, lat, lon, seg, cum } = P;
  if (n < 1) return [];
  let s = 90, no = -90, w = 180, e = -180;
  for (let i = 0; i < n; i++) {
    if (lat[i] < s) s = lat[i]; if (lat[i] > no) no = lat[i];
    if (lon[i] < w) w = lon[i]; if (lon[i] > e) e = lon[i];
  }
  const ky = M_PER_DEG, kx = M_PER_DEG * Math.cos(toRad((s + no) / 2));
  const pLat = radius / ky, pLon = radius / kx;
  let cands = only;
  if (!cands) {
    cands = Ref.query(w - pLon, s - pLat, e + pLon, no + pLat).map((i) => Ref.peak(i));
    for (const [id, c] of Object.entries(S.data.customPeaks)) {
      if (c.lat >= s - pLat && c.lat <= no + pLat && c.lon >= w - pLon && c.lon <= e + pLon) cands.push({ id, name: c.name, ele: c.ele ?? null, lat: c.lat, lon: c.lon });
    }
  }
  if (!cands.length) return [];
  // rejilla de segmentos con celdas del tamaño del radio
  const grid = new Map();
  const key = (cx, cy) => cy * 1e6 + cx;
  const add = (cx, cy, i) => { const k = key(cx, cy); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); };
  if (n === 1) add(Math.floor(lon[0] / pLon), Math.floor(lat[0] / pLat), 0);
  for (let i = 0; i < n - 1; i++) {
    if (seg[i + 1] !== seg[i]) continue;
    const x0 = Math.floor(Math.min(lon[i], lon[i + 1]) / pLon), x1 = Math.floor(Math.max(lon[i], lon[i + 1]) / pLon);
    const y0 = Math.floor(Math.min(lat[i], lat[i + 1]) / pLat), y1 = Math.floor(Math.max(lat[i], lat[i + 1]) / pLat);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) add(cx, cy, i);
  }
  const out = [];
  for (const p of cands) {
    const cx = Math.floor(p.lon / pLon), cy = Math.floor(p.lat / pLat);
    let best = Infinity, along = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const list = grid.get(key(cx + dx, cy + dy));
      if (!list) continue;
      for (const i of list) {
        const j = n === 1 ? i : i + 1;
        const ax = (lon[i] - p.lon) * kx, ay = (lat[i] - p.lat) * ky;
        const vx = (lon[j] - p.lon) * kx - ax, vy = (lat[j] - p.lat) * ky - ay;
        const L2 = vx * vx + vy * vy;
        let tt = L2 > 0 ? -(ax * vx + ay * vy) / L2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const qx = ax + tt * vx, qy = ay + tt * vy;
        const d2 = qx * qx + qy * qy;
        if (d2 < best) { best = d2; along = cum[i] + tt * (cum[j] - cum[i]); }
      }
    }
    const d = Math.sqrt(best);
    if (d <= radius) out.push(peakEntry(p, d, along));
  }
  return out.sort((a, b) => a.at - b.at);
}
/** Entrada de cumbre en una ruta. Lleva una copia mínima de la cumbre para que la ruta sea autosuficiente. */
function peakEntry(p, d, along, manual = false) {
  const e = { id: p.id, d: Math.round(d * 10) / 10, at: Math.round(along), n: p.name, la: Math.round(p.lat * 1e5) / 1e5, lo: Math.round(p.lon * 1e5) / 1e5 };
  if (p.ele != null) e.e = Math.round(p.ele);
  if (manual) e.m = 1;
  return e;
}
/** Distancia mínima (m) de un punto al track y posición a lo largo del recorrido. */
function nearestOnTrack(P, plat, plon) {
  const r = detectOnTrack(P, 1e7, [{ id: 'x', name: '', lat: plat, lon: plon }]);
  return r[0] || { d: Infinity, at: 0 };
}
function classify(d) {
  const { summitM, nearM } = S.data.settings;
  return d <= summitM ? 'climbed' : d <= nearM ? 'near' : 'none';
}
/** Estado efectivo: la decisión del usuario prevalece sobre la automática. */
function statusOf(route, pe) {
  const dec = route.decisions && route.decisions[pe.id];
  if (dec) return dec;
  if (pe.m) return 'climbed';
  return classify(pe.d);
}

/* Overpass solo para rutas fuera de la zona incluida y si hay red (fuera de Claude). */
async function overpassPeaks(P, radius) {
  let s = 90, no = -90, w = 180, e = -180;
  for (let i = 0; i < P.n; i++) { s = Math.min(s, P.lat[i]); no = Math.max(no, P.lat[i]); w = Math.min(w, P.lon[i]); e = Math.max(e, P.lon[i]); }
  const pLat = radius / M_PER_DEG, pLon = radius / (M_PER_DEG * Math.cos(toRad((s + no) / 2)));
  const bb = [s - pLat, w - pLon, no + pLat, e + pLon].map((v) => v.toFixed(5)).join(',');
  const q = `[out:json][timeout:25];(node[natural=peak][name](${bb});node[natural=volcano][name](${bb}););out body;`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
    if (!res.ok) throw new Error('Overpass ' + res.status);
    const js = await res.json();
    return (js.elements || []).map((el) => {
      const ele = parseFloat(String(el.tags?.ele || '').replace(',', '.'));
      return { id: 'osm:' + el.id, name: el.tags?.name || '', ele: isFinite(ele) ? Math.round(ele) : null, lat: el.lat, lon: el.lon };
    }).filter((p) => p.name);
  } finally { clearTimeout(timer); }
}
