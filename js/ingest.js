'use strict';
/* ============ 5. Fuentes de rutas → ingestRoutes() ============
   Toda ruta nueva entra por ingestRoutes(), venga de donde venga. Una fuente solo tiene que
   convertir lo que recibe en "rutas normalizadas":

     {
       name: string,
       type?: string,                         // tipo crudo ('hiking', 'trail_running'…) o un id de TYPES
       segments: [[{ lat, lon, ele?, time? }]],  // time en milisegundos epoch
       time?: number,                         // fecha de respaldo si los puntos no traen hora
       source: { kind: 'gpx' | 'garmin' | …, file?: string, externalId?: string }
     }

   ingestRoutes() hace el resto: estadísticas, deduplicado, simplificado, cumbres y guardado.
   Garmin Connect entra por el repositorio de datos (ver RouteSources.garmin y GitSync): cada
   actividad trae `externalId` = 'garmin:<id>', que el deduplicado usa para no repetirla. */
const RouteSources = {
  gpx: {
    id: 'gpx',
    label: 'Archivos GPX',
    accepts: (file) => /\.gpx$/i.test(file.name) || file.type === 'application/gpx+xml',
    async read(file) { return parseGpx(await file.text(), file.name); },
  },
};

function findDuplicate(fp, externalId, extraFps = []) {
  for (const r of S.routes.values()) {
    if (externalId && r.source?.externalId === externalId) return r;
    if (sameActivity(fp, r.fp)) return r;
  }
  for (const x of extraFps) if (sameActivity(fp, x.fp)) return x;
  return null;
}
const routeIdFor = (fp) => 'r' + cyrb64(fp.h + '|' + (fp.t ?? '')).slice(0, 14);

async function ingestRoutes(items, { onProgress } = {}) {
  const res = { added: [], duplicates: [], errors: [] };
  const batch = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const label = it.name || it.source?.file || 'Ruta';
    try {
      const T = buildTrack(it.segments);
      if (T.n < 2) throw new Error('el track tiene menos de dos puntos');
      const stats = computeStats(T);
      const fp = fingerprint(T, stats);
      const dup = findDuplicate(fp, it.source?.externalId, batch);
      if (dup) { res.duplicates.push({ name: label, of: dup.name }); continue; }
      const idx = simplifyForStorage(T);
      const trk = encodeTrack(T, idx);
      const P = decodeTrack(trk);
      let peaks = detectOnTrack(P);
      if (!Ref.covers(P.lat[0], P.lon[0]) && Net.online) {
        try { peaks = detectOnTrack(P, SEARCH_RADIUS, await overpassPeaks(P, SEARCH_RADIUS)); } catch (e) { /* sin red: seguimos */ }
      }
      let w = 180, s = 90, e = -180, n = -90;
      for (let i = 0; i < P.n; i++) { w = Math.min(w, P.lon[i]); e = Math.max(e, P.lon[i]); s = Math.min(s, P.lat[i]); n = Math.max(n, P.lat[i]); }
      const startMs = stats.start != null ? stats.start * 1000 : it.time ?? null;
      const route = {
        id: routeIdFor(fp), v: 1,
        name: String(it.name || label).trim().slice(0, 200) || 'Ruta sin nombre',
        date: startMs != null ? new Date(startMs).toISOString() : null,
        type: TYPE_LABEL[it.type] ? it.type : mapType(it.type, it.name),
        source: { kind: it.source?.kind || 'gpx', file: it.source?.file || null, externalId: it.source?.externalId || null },
        fp, stats, bbox: [w, s, e, n].map((v) => Math.round(v * 1e5) / 1e5), trk, peaks, decisions: {},
        created: new Date().toISOString(),
      };
      route.updated = route.created;
      if (JSON.stringify(route).length > 240000) throw new Error('el track es demasiado grande para guardarlo');
      await S.store.saveRoute(serializeRoute(route));
      hydrateRoute(route, P);
      S.routes.set(route.id, route);
      if (S.data.deleted[route.id]) delete S.data.deleted[route.id];
      batch.push(route);
      res.added.push(route);
    } catch (e) {
      res.errors.push({ name: label, msg: e?.message || String(e) });
    }
    onProgress && onProgress(k + 1, items.length);
    if (k % 2 === 1) await sleep(0);
  }
  invalidate();
  return res;
}
async function importGpxFiles(files) {
  const items = [], errors = [];
  for (const f of files) {
    try { items.push(...(await RouteSources.gpx.read(f))); }
    catch (e) { errors.push({ name: f.name, msg: e.message }); }
  }
  const res = items.length ? await ingestRoutes(items, { onProgress: (a, b) => UI.progress(a, b) }) : { added: [], duplicates: [], errors: [] };
  res.errors.unshift(...errors);
  return res;
}
