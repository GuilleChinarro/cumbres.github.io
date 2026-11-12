'use strict';
/* ===================== 7. Estado y acciones ===================== */
const DEFAULT_DATA = () => ({
  v: 1,
  settings: { summitM: 50, nearM: 300 },
  customPeaks: {},   // 'u:…' → {name, ele, lat, lon, sierra}
  peakEdits: {},     // id → {name?, ele?, sierra?}
  sierraRenames: {}, // nombre GMBA → nombre propio
  hidden: [],        // rutas ocultas en el mapa
  deleted: {},       // borrados (id de ruta o 'peak:<id>') → fecha; se propagan al sincronizar
  garminDone: {},    // actividades de Garmin ya importadas
  updated: null,     // última modificación hecha en este dispositivo
});
const S = {
  store: null,
  loaded: false,
  readOnly: false,
  data: DEFAULT_DATA(),
  routes: new Map(),
  cache: { mountains: null },
  ui: {
    view: 'routes', routeId: null, peakId: null, prev: 'routes',
    filters: { year: '', type: '', sierra: '', peak: '', q: '' },
    includeNear: false, sortPeaks: 'ele', mq: '',
    addPeakOpen: false, addPeakQ: '', placing: null, newPeak: null,
    selRoute: null,
  },
};
const Net = { online: false, tiles: {}, dem: false };

function mergeData(st) {
  const d = DEFAULT_DATA();
  if (!st || typeof st !== 'object') return d;
  const s = st.settings || {};
  d.settings.summitM = clamp(+s.summitM || 50, 5, 500);
  d.settings.nearM = clamp(+s.nearM || 300, d.settings.summitM, 1000);
  for (const k of ['customPeaks', 'peakEdits', 'sierraRenames']) if (st[k] && typeof st[k] === 'object') d[k] = { ...st[k] };
  if (Array.isArray(st.hidden)) d.hidden = [...new Set(st.hidden.filter((x) => typeof x === 'string'))];
  const old = new Date(Date.now() - 400 * 86400000).toISOString();
  if (st.deleted && typeof st.deleted === 'object') for (const [k, t] of Object.entries(st.deleted)) if (typeof t === 'string' && t > old) d.deleted[k] = t;
  if (st.garminDone && typeof st.garminDone === 'object') for (const [k, t] of Object.entries(st.garminDone)) if (typeof t === 'string') d.garminDone[k] = t;
  if (typeof st.updated === 'string') d.updated = st.updated;
  return d;
}

function hydrateRoute(r, P) {
  r.decisions = r.decisions && typeof r.decisions === 'object' ? r.decisions : {};
  r.peaks = Array.isArray(r.peaks) ? r.peaks : [];
  r._P = P || decodeTrack(r.trk);
  r._color = routeColor(r.id);
  r._sier = null;
  return r;
}

let saveDataTimer = null;
/** Guarda los datos generales. `stamp`: es un cambio hecho aquí (no una fusión con datos de fuera). */
function saveData(now = false, stamp = true) {
  if (stamp) S.data.updated = new Date().toISOString();
  clearTimeout(saveDataTimer);
  const run = () => S.store.saveState(clone(S.data)).catch((e) => UI.toast(storeErrorMessage(e), { err: true }));
  if (now) return run();
  saveDataTimer = setTimeout(run, 500);
}
function saveRoute(r) {
  r.updated = new Date().toISOString();
  return S.store.saveRoute(serializeRoute(r)).catch((e) => UI.toast(storeErrorMessage(e), { err: true }));
}
function invalidate() {
  S.cache.mountains = null;
  for (const r of S.routes.values()) r._sier = null;
}

/* Información de una cumbre, con tus correcciones aplicadas */
function renameSierra(name) { return (name && S.data.sierraRenames[name]) || name || ''; }
function peakInfo(id, snap) {
  let p = null;
  if (id.startsWith('u:')) {
    const c = S.data.customPeaks[id];
    if (c) p = { id, name: c.name, ele: c.ele ?? null, lat: c.lat, lon: c.lon, sierra: c.sierra || '', custom: true };
  } else {
    const i = Ref.idIndex.get(id);
    if (i !== undefined) p = Ref.peak(i);
  }
  if (!p && snap) p = { id, name: snap.n, ele: snap.e ?? null, lat: snap.la, lon: snap.lo, sierra: Ref.ready ? Ref.sierraAt(snap.lo, snap.la) : '' };
  if (!p) return null;
  const ed = S.data.peakEdits[id];
  let sierraEdited = false;
  if (ed) {
    if (ed.name) p.name = ed.name;
    if (ed.ele != null && ed.ele !== '') p.ele = +ed.ele;
    if (ed.sierra != null) { p.sierra = ed.sierra; sierraEdited = true; }
  }
  if (!sierraEdited && !p.custom) p.sierra = renameSierra(p.sierra);
  p.edited = !!ed;
  return p;
}

function routeSierras(r) {
  if (r._sier) return r._sier;
  const w = new Map();
  for (const pe of r.peaks) {
    const st = statusOf(r, pe);
    if (st === 'none') continue;
    const info = peakInfo(pe.id, pe);
    if (info && info.sierra) w.set(info.sierra, (w.get(info.sierra) || 0) + (st === 'climbed' ? 3 : 1));
  }
  const P = r._P;
  if (P && Ref.ready) {
    const step = Math.max(1, Math.floor(P.n / 40));
    const tw = new Map();
    let cnt = 0;
    for (let i = 0; i < P.n; i += step) {
      cnt++;
      const s = Ref.sierraAt(P.lon[i], P.lat[i], false);
      if (s) tw.set(s, (tw.get(s) || 0) + 1);
    }
    for (const [s, c] of tw) if (c / cnt >= 0.25) { const nm = renameSierra(s); w.set(nm, (w.get(nm) || 0) + (2 * c) / cnt); }
  }
  r._sier = [...w.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  return r._sier;
}

function byDateDesc(a, b) { return (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name); }
function routesSorted() { return [...S.routes.values()].sort(byDateDesc); }

/** Montañas: cumbres subidas o pasadas cerca, agregadas sobre todas las rutas. */
function mountains() {
  if (S.cache.mountains) return S.cache.mountains;
  const M = new Map();
  for (const r of S.routes.values()) {
    for (const pe of r.peaks) {
      const st = statusOf(r, pe);
      if (st === 'none') continue;
      let m = M.get(pe.id);
      if (!m) M.set(pe.id, (m = { id: pe.id, climbs: [], nears: [], snap: pe }));
      (st === 'climbed' ? m.climbs : m.nears).push(r);
    }
  }
  for (const m of M.values()) {
    m.info = peakInfo(m.id, m.snap) || { id: m.id, name: m.snap.n || 'Cumbre', ele: m.snap.e ?? null, lat: m.snap.la, lon: m.snap.lo, sierra: '' };
    m.climbs.sort(byDateDesc);
    m.nears.sort(byDateDesc);
    m.last = m.climbs[0]?.date || m.nears[0]?.date || null;
  }
  S.cache.mountains = M;
  return M;
}

function routeMatches(r, f, skip = '') {
  if (skip !== 'year' && f.year && (fmt.year(r.date) || 'sin') !== f.year) return false;
  if (skip !== 'type' && f.type && r.type !== f.type) return false;
  if (skip !== 'sierra' && f.sierra && !routeSierras(r).includes(f.sierra)) return false;
  if (skip !== 'peak' && f.peak) {
    const pe = r.peaks.find((p) => p.id === f.peak);
    if (!pe) return false;
    const st = statusOf(r, pe);
    if (!(st === 'climbed' || (S.ui.includeNear && st === 'near'))) return false;
  }
  if (f.q && !norm(r.name).includes(norm(f.q))) return false;
  return true;
}
function filteredRoutes() { return routesSorted().filter((r) => routeMatches(r, S.ui.filters)); }
function anyFilter() { const f = S.ui.filters; return !!(f.year || f.type || f.sierra || f.peak || f.q); }
function isHidden(id) { return S.data.hidden.includes(id); }
function visibleOnMap() { return filteredRoutes().filter((r) => !isHidden(r.id)); }

/* Acciones */
const Actions = {
  setDecision(routeId, peakId, value) {
    const r = S.routes.get(routeId);
    if (!r) return;
    if (value) r.decisions[peakId] = value; else delete r.decisions[peakId];
    invalidate(); saveRoute(r);
  },
  setRouteField(routeId, field, value) {
    const r = S.routes.get(routeId);
    if (!r) return;
    if (field === 'name') r.name = String(value).trim().slice(0, 200) || r.name;
    else if (field === 'type' && TYPE_LABEL[value]) r.type = value;
    else if (field === 'date') {
      if (!value) r.date = null;
      else {
        const old = r.date ? new Date(r.date) : null;
        const [y, mo, d] = value.split('-').map(Number);
        const nd = old ? new Date(old) : new Date(y, mo - 1, d, 9, 0, 0);
        nd.setFullYear(y, mo - 1, d);
        r.date = nd.toISOString();
      }
    } else return;
    invalidate(); saveRoute(r);
  },
  toggleHidden(id) {
    const i = S.data.hidden.indexOf(id);
    if (i >= 0) S.data.hidden.splice(i, 1); else S.data.hidden.push(id);
    saveData();
  },
  showAll() { S.data.hidden = []; saveData(); },
  async deleteRoute(id) {
    const r = S.routes.get(id);
    if (!r) return;
    await S.store.deleteRoute(id);
    S.routes.delete(id);
    S.data.hidden = S.data.hidden.filter((x) => x !== id);
    S.data.deleted[id] = new Date().toISOString();
    invalidate(); saveData();
  },
  addPeakToRoute(routeId, peak) {
    const r = S.routes.get(routeId);
    if (!r) return;
    let pe = r.peaks.find((p) => p.id === peak.id);
    if (!pe) {
      const near = nearestOnTrack(r._P, peak.lat, peak.lon);
      pe = peakEntry(peak, near.d, near.at, true);
      r.peaks.push(pe);
      r.peaks.sort((a, b) => a.at - b.at);
    }
    r.decisions[peak.id] = 'climbed';
    invalidate(); saveRoute(r);
  },
  /** Cumbre nueva creada por ti: se busca en todas tus rutas. */
  createCustomPeak({ name, ele, lat, lon }, routeId) {
    const id = 'u:' + randomId();
    const sierra = renameSierra(Ref.sierraAt(lon, lat));
    S.data.customPeaks[id] = { name: String(name).trim().slice(0, 120), ele: ele === '' || ele == null || !isFinite(+ele) ? null : Math.round(+ele), lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, sierra };
    const peak = { id, ...S.data.customPeaks[id] };
    for (const r of S.routes.values()) {
      const [w, s, e, n] = r.bbox;
      const pad = 0.015;
      if (lat < s - pad || lat > n + pad || lon < w - pad || lon > e + pad) continue;
      const found = detectOnTrack(r._P, SEARCH_RADIUS, [peak]);
      if (found.length && !r.peaks.some((p) => p.id === id)) { r.peaks.push(found[0]); r.peaks.sort((a, b) => a.at - b.at); if (r.id !== routeId) saveRoute(r); }
    }
    saveData(true);
    if (routeId) Actions.addPeakToRoute(routeId, peak);
    invalidate();
    return id;
  },
  editPeak(id, field, value) {
    if (id.startsWith('u:')) {
      const c = S.data.customPeaks[id];
      if (!c) return;
      if (field === 'name') c.name = String(value).trim().slice(0, 120) || c.name;
      if (field === 'ele') c.ele = value === '' || !isFinite(+value) ? null : Math.round(+value);
      if (field === 'sierra') c.sierra = String(value).trim().slice(0, 120);
    } else {
      const ed = S.data.peakEdits[id] || (S.data.peakEdits[id] = {});
      if (field === 'name') { const v = String(value).trim().slice(0, 120); if (v) ed.name = v; else delete ed.name; }
      if (field === 'ele') { if (value === '' || !isFinite(+value)) delete ed.ele; else ed.ele = Math.round(+value); }
      if (field === 'sierra') ed.sierra = String(value).trim().slice(0, 120);
      if (!Object.keys(ed).length) delete S.data.peakEdits[id];
    }
    invalidate(); saveData();
  },
  resetPeak(id) { delete S.data.peakEdits[id]; invalidate(); saveData(); },
  deleteCustomPeak(id) {
    delete S.data.customPeaks[id];
    S.data.deleted['peak:' + id] = new Date().toISOString();
    for (const r of S.routes.values()) {
      const before = r.peaks.length;
      r.peaks = r.peaks.filter((p) => p.id !== id);
      if (r.decisions[id]) delete r.decisions[id];
      if (r.peaks.length !== before) saveRoute(r);
    }
    invalidate(); saveData(true);
  },
  renameSierra(orig, value) {
    const v = String(value).trim().slice(0, 120);
    if (!v || v === orig) delete S.data.sierraRenames[orig]; else S.data.sierraRenames[orig] = v;
    if (S.ui.filters.sierra) S.ui.filters.sierra = '';
    invalidate(); saveData();
  },
  setThresholds(summitM, nearM) {
    const s = clamp(Math.round(+summitM) || 50, 5, 500);
    const n = clamp(Math.round(+nearM) || 300, s, SEARCH_RADIUS);
    S.data.settings.summitM = s; S.data.settings.nearM = n;
    invalidate(); saveData();
  },
  /** Vuelve a cruzar todas las rutas con las cumbres; conserva tus decisiones y cumbres añadidas a mano. */
  async redetectAll(onProgress) {
    let k = 0, changed = 0;
    for (const r of S.routes.values()) {
      const found = detectOnTrack(r._P);
      const byId = new Map(found.map((p) => [p.id, p]));
      const merged = [];
      for (const p of r.peaks) {
        const nf = byId.get(p.id);
        if (nf) { merged.push(p.m ? { ...nf, m: 1 } : nf); byId.delete(p.id); }
        else if (p.m || r.decisions[p.id]) merged.push(p);
      }
      for (const p of byId.values()) merged.push(p);
      merged.sort((a, b) => a.at - b.at);
      if (JSON.stringify(merged) !== JSON.stringify(r.peaks)) { r.peaks = merged; changed++; await saveRoute(r); }
      onProgress && onProgress(++k, S.routes.size);
      if (k % 5 === 0) await sleep(0);
    }
    invalidate();
    return changed;
  },
  async deleteAll() {
    const now = new Date().toISOString();
    const deleted = { ...S.data.deleted }, garminDone = { ...S.data.garminDone };
    for (const id of [...S.routes.keys()]) { await S.store.deleteRoute(id); S.routes.delete(id); deleted[id] = now; }
    for (const id of Object.keys(S.data.customPeaks)) deleted['peak:' + id] = now;
    S.data = DEFAULT_DATA();
    S.data.deleted = deleted;
    S.data.garminDone = garminDone;
    await saveData(true);
    invalidate();
  },
};

/* Exportar / importar */
const EXPORT_APP = 'cuaderno-de-cumbres';
function exportPayload() {
  return {
    app: EXPORT_APP, format: 1, exportedAt: new Date().toISOString(),
    peaksSnapshot: Ref.meta?.snapshot || null,
    data: clone(S.data),
    routes: routesSorted().map(serializeRoute),
  };
}
function sanitizeRoute(o) {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(o.id)) throw new Error('ruta sin identificador válido');
  if (!o.trk || typeof o.trk.d !== 'string' || !isFinite(o.trk.n)) throw new Error('ruta sin track');
  const r = {
    id: o.id, v: 1, name: String(o.name || 'Ruta').slice(0, 200), date: o.date && isFinite(Date.parse(o.date)) ? new Date(o.date).toISOString() : null,
    type: TYPE_LABEL[o.type] ? o.type : 'senderismo',
    source: { kind: String(o.source?.kind || 'gpx').slice(0, 30), file: o.source?.file ? String(o.source.file).slice(0, 200) : null, externalId: o.source?.externalId ? String(o.source.externalId).slice(0, 100) : null },
    fp: o.fp && typeof o.fp === 'object' ? o.fp : null, stats: o.stats && typeof o.stats === 'object' ? o.stats : {},
    bbox: Array.isArray(o.bbox) && o.bbox.length === 4 ? o.bbox.map(Number) : null,
    trk: { f: +o.trk.f | 0, n: +o.trk.n | 0, t0: +o.trk.t0 || 0, d: o.trk.d },
    peaks: Array.isArray(o.peaks) ? o.peaks.filter((p) => p && typeof p.id === 'string' && isFinite(p.d)).map((p) => ({ ...p, n: String(p.n || '').slice(0, 120) })) : [],
    decisions: {}, created: o.created || new Date().toISOString(),
  };
  if (o.updated && isFinite(Date.parse(o.updated))) r.updated = new Date(o.updated).toISOString();
  if (o.decisions && typeof o.decisions === 'object') for (const [k, v] of Object.entries(o.decisions)) if (['climbed', 'near', 'none'].includes(v)) r.decisions[k] = v;
  const P = decodeTrack(r.trk);
  if (!r.bbox) { let w = 180, s = 90, e = -180, n = -90; for (let i = 0; i < P.n; i++) { w = Math.min(w, P.lon[i]); e = Math.max(e, P.lon[i]); s = Math.min(s, P.lat[i]); n = Math.max(n, P.lat[i]); } r.bbox = [w, s, e, n]; }
  if (!r.fp) r.fp = { h: cyrb64(r.trk.d), t: r.trk.f & 2 ? r.trk.t0 : null, d: P.cum[P.n - 1], a: [P.lat[0], P.lon[0]], b: [P.lat[P.n - 1], P.lon[P.n - 1]] };
  return { r, P };
}
const stampOf = (r) => (r && (r.updated || r.created)) || '';
/** Une una ruta que llega de fuera (otro dispositivo, una exportación): gana la versión más reciente y se respetan los borrados. */
async function mergeRoute(raw) {
  const { r, P } = sanitizeRoute(raw);
  const tomb = S.data.deleted[r.id];
  if (tomb && tomb >= stampOf(r)) return 'deleted';
  const local = S.routes.get(r.id);
  if (local && stampOf(local) >= stampOf(r)) return 'same';
  if (!local && findDuplicate(r.fp, r.source.externalId)) return 'dup';
  if (tomb) delete S.data.deleted[r.id];
  await S.store.saveRoute(serializeRoute(r));
  hydrateRoute(r, P);
  S.routes.set(r.id, r);
  return local ? 'updated' : 'added';
}
/** Une los datos generales que llegan de fuera: borrados, cumbres propias y Garmin se suman; lo demás, gana lo más reciente. */
async function mergeIncomingData(inc) {
  const d = mergeData(inc), L = S.data;
  const newer = (d.updated || '') > (L.updated || '');
  let changed = false;
  for (const [k, t] of Object.entries(d.deleted)) if (!L.deleted[k] || L.deleted[k] < t) { L.deleted[k] = t; changed = true; }
  for (const [k, t] of Object.entries(L.deleted)) {
    if (k.startsWith('peak:')) { if (L.customPeaks[k.slice(5)]) { delete L.customPeaks[k.slice(5)]; changed = true; } continue; }
    const r = S.routes.get(k);
    if (r && stampOf(r) <= t) { await S.store.deleteRoute(k); S.routes.delete(k); changed = true; }
  }
  for (const [id, cp] of Object.entries(d.customPeaks)) {
    if (L.deleted['peak:' + id]) continue;
    if (!L.customPeaks[id] || (newer && JSON.stringify(L.customPeaks[id]) !== JSON.stringify(cp))) { L.customPeaks[id] = cp; changed = true; }
  }
  for (const [k, t] of Object.entries(d.garminDone)) if (!L.garminDone[k]) { L.garminDone[k] = t; changed = true; }
  if (newer) {
    L.settings = d.settings; L.peakEdits = d.peakEdits; L.sierraRenames = d.sierraRenames; L.hidden = d.hidden; L.updated = d.updated;
    changed = true;
  }
  if (changed) { invalidate(); await saveData(true, false); }
  return changed;
}
/** Importar = fusionar: rutas nuevas se añaden, las cambiadas se actualizan si son más recientes y los borrados se aplican. */
async function importPayload(obj, onProgress) {
  if (!obj || obj.app !== EXPORT_APP || !Array.isArray(obj.routes)) throw new Error('El archivo no es una exportación del cuaderno de cumbres.');
  const res = { added: 0, updated: 0, same: 0, errors: 0 };
  if (obj.data) await mergeIncomingData(obj.data);
  let k = 0;
  for (const raw of obj.routes) {
    try {
      const st = await mergeRoute(raw);
      if (st === 'added') res.added++; else if (st === 'updated') res.updated++; else res.same++;
    } catch (e) { console.warn('ruta descartada', e); res.errors++; }
    onProgress && onProgress(++k, obj.routes.length);
    if (k % 4 === 0) await sleep(0);
  }
  invalidate();
  return res;
}

/* Techos de provincia según OpenStreetMap (las cumbres de frontera cuentan para ambas provincias). */
const TECHOS = [{"p": "Albacete", "id": "osm:7329872831", "n": "La Atalaya", "e": 2083}, {"p": "Alicante", "id": "osm:948643721", "n": "Aitana", "e": 1559}, {"p": "Almería", "id": "osm:26862682", "n": "Chullo", "e": 2612}, {"p": "Asturias", "id": "osm:948414574", "n": "Torre Cerredo", "e": 2649}, {"p": "Badajoz", "id": "osm:7340347606", "n": "Tentudía", "e": 1112}, {"p": "Barcelona", "id": "osm:1678253894", "n": "Comabona", "e": 2549}, {"p": "Burgos", "id": "osm:948592536", "n": "San Millán", "e": 2129}, {"p": "Cantabria", "id": "osm:129961981", "n": "Peña Vieja", "e": 2614}, {"p": "Castellón", "id": "osm:276913145", "n": "Penyagolosa", "e": 1815}, {"p": "Ciudad Real", "id": "osm:946766443", "n": "Amor", "e": 1380}, {"p": "Cuenca", "id": "osm:948772165", "n": "Mogorrita", "e": 1864}, {"p": "Cáceres", "id": "osm:1241470032", "n": "Canchal de la Ceja", "e": 2427}, {"p": "Cádiz", "id": "osm:692915049", "n": "El Torreón", "e": 1648}, {"p": "Córdoba", "id": "osm:949518058", "n": "La Tiñosa", "e": 1568}, {"p": "Gerona", "id": "osm:579893382", "n": "Puigpedrós", "e": 2915}, {"p": "Granada", "id": "osm:26864261", "n": "Pico de Mulhacén", "e": 3479}, {"p": "Guadalajara", "id": "osm:26863557", "n": "Pico del Lobo", "e": 2274}, {"p": "Guipúzcoa", "id": "osm:4779089024", "n": "Aketegi", "e": 1549}, {"p": "Huelva", "id": "osm:1241330799", "n": "Cumbre de las Ceborillas", "e": 1038}, {"p": "Huesca", "id": "osm:4252339778", "n": "Tuca d'Aneto / Maladeta de Corones", "e": 3404}, {"p": "Islas Baleares", "id": "osm:788275291", "n": "Puig Major", "e": 1436}, {"p": "Jaén", "id": "osm:26864642", "n": "Mágina", "e": 2165}, {"p": "La Coruña", "id": "osm:7027537922", "n": "Monte Campelo", "e": 803}, {"p": "La Rioja", "id": "osm:948486220", "n": "Monte San Lorenzo", "e": 2271}, {"p": "Las Palmas", "id": "osm:5343666182", "n": "Morrón de la Agujereada", "e": 1956}, {"p": "León", "id": "osm:948414574", "n": "Torre Cerredo", "e": 2649}, {"p": "Lugo", "id": "osm:1250018356", "n": "Pena Longa", "e": 1896}, {"p": "Lérida", "id": "osm:26864258", "n": "Pica d'Estats / Pique d'Estats", "e": 3143}, {"p": "Madrid", "id": "osm:840703994", "n": "Peñalara", "e": 2428}, {"p": "Murcia", "id": "osm:4606017199", "n": "Obispo", "e": 2014}, {"p": "Málaga", "id": "osm:10313278387", "n": "Maroma", "e": 2069}, {"p": "Navarra", "id": "osm:1304119639", "n": "Budogia", "e": 2368}, {"p": "Orense", "id": "osm:26864595", "n": "Pena Trevinca", "e": 2127}, {"p": "Palencia", "id": "osm:948475375", "n": "Peña Prieta", "e": 2539}, {"p": "Pontevedra", "id": "osm:7027538159", "n": "O Faro", "e": 1180}, {"p": "Salamanca", "id": "osm:1241470032", "n": "Canchal de la Ceja", "e": 2427}, {"p": "Santa Cruz de Tenerife", "id": "osm:6447099369", "n": "Teide", "e": 3715}, {"p": "Segovia", "id": "osm:840703994", "n": "Peñalara", "e": 2428}, {"p": "Sevilla", "id": "osm:949513913", "n": "Terril", "e": 1128}, {"p": "Soria", "id": "osm:26864637", "n": "Moncayo", "e": 2314}, {"p": "Tarragona", "id": "osm:2032330864", "n": "Caro", "e": 1441}, {"p": "Teruel", "id": "osm:11174874938", "n": "Peñarroya", "e": 2021}, {"p": "Toledo", "id": "osm:563869458", "n": "Rocigalgo", "e": 1449}, {"p": "Valencia", "id": "osm:3056896514", "n": "Alto de las Barracas", "e": 1838}, {"p": "Valladolid", "id": "osm:5278090581", "n": "Cuchillejo", "e": 934}, {"p": "Vizcaya", "id": "osm:511135960", "n": "Gorbeiako gurutzea", "e": 1482}, {"p": "Zamora", "id": "osm:26864595", "n": "Pena Trevinca", "e": 2127}, {"p": "Zaragoza", "id": "osm:26864637", "n": "Moncayo", "e": 2314}, {"p": "Álava", "id": "osm:4779095127", "n": "Tontorraundi", "e": 1484}, {"p": "Ávila", "id": "osm:1249815120", "n": "Pico Almanzor", "e": 2592}];
