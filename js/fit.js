'use strict';
/* ===================== 2b. Lectura de FIT (Garmin) y exportación GPX =====================
   Lector mínimo del formato FIT: solo lo necesario para sacar el track (mensajes «record») y el
   deporte (mensajes «session»/«sport»). Sirve para los archivos originales que exporta Garmin
   Connect («Exportar original») y los que quedan en la carpeta GARMIN/Activity del reloj. */
const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z en segundos Unix
const FIT_SPORT = {
  1: 'running', 2: 'cycling', 11: 'walking', 12: 'cross_country_skiing', 13: 'alpine_skiing', 14: 'snowboarding',
  16: 'mountaineering', 17: 'hiking', 21: 'e_biking', 31: 'rock_climbing', 35: 'snowshoeing', 48: 'floor_climbing',
};
const FIT_SUBSPORT = { 3: 'trail', 8: 'mountain bike', 37: 'backcountry ski', 68: 'indoor climbing', 69: 'bouldering' };

function parseFit(buf, fileName = '') {
  const dv = new DataView(buf), len = dv.byteLength;
  if (len < 14) throw new Error('no es un FIT válido');
  const hs = dv.getUint8(0);
  if (String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11)) !== '.FIT') throw new Error('no es un FIT válido');
  const end = Math.min(len, hs + dv.getUint32(4, true));
  const defs = {};
  const pts = [];
  let sport = null, sub = null, lastTs = 0, name = null;
  let o = hs;
  const readField = (off, size, base, le) => {
    switch (base & 0x1f) {
      case 0: case 2: case 10: case 13: { const v = dv.getUint8(off); return v === 0xff ? null : v; }
      case 1: { const v = dv.getInt8(off); return v === 0x7f ? null : v; }
      case 3: { if (size < 2) return null; const v = dv.getInt16(off, le); return v === 0x7fff ? null : v; }
      case 4: case 11: { if (size < 2) return null; const v = dv.getUint16(off, le); return v === 0xffff ? null : v; }
      case 5: { if (size < 4) return null; const v = dv.getInt32(off, le); return v === 0x7fffffff ? null : v; }
      case 6: case 12: { if (size < 4) return null; const v = dv.getUint32(off, le); return v === 0xffffffff ? null : v; }
      case 7: { let s = ''; for (let i = 0; i < size; i++) { const c = dv.getUint8(off + i); if (!c) break; s += String.fromCharCode(c); } try { return decodeURIComponent(escape(s)); } catch { return s; } }
      default: return null;
    }
  };
  while (o < end) {
    const h = dv.getUint8(o++);
    let local, tsOffset = null;
    if (h & 0x80) { local = (h >> 5) & 3; tsOffset = h & 0x1f; }
    else if (h & 0x40) {
      // mensaje de definición
      local = h & 0x0f;
      const le = dv.getUint8(o + 1) === 0;
      const global = dv.getUint16(o + 2, le), nf = dv.getUint8(o + 4);
      o += 5;
      const fields = [];
      let size = 0;
      for (let i = 0; i < nf; i++, o += 3) { const f = { num: dv.getUint8(o), size: dv.getUint8(o + 1), base: dv.getUint8(o + 2), off: size }; size += f.size; fields.push(f); }
      if (h & 0x20) { const nd = dv.getUint8(o++); for (let i = 0; i < nd; i++, o += 3) size += dv.getUint8(o + 1); }
      defs[local] = { global, le, fields, size };
      continue;
    } else local = h & 0x0f;
    const d = defs[local];
    if (!d) throw new Error('FIT dañado');
    if (o + d.size > len) break;
    if (d.global === 20 || d.global === 18 || d.global === 12) {
      const v = {};
      for (const f of d.fields) v[f.num] = readField(o + f.off, f.size, f.base, d.le);
      if (d.global === 20) {
        let ts = v[253];
        if (ts != null) lastTs = ts;
        else if (tsOffset != null) { ts = (lastTs & ~0x1f) + tsOffset; if (ts < lastTs) ts += 32; lastTs = ts; }
        const alt = v[78] != null ? v[78] : v[2];
        if (v[0] != null && v[1] != null) {
          const lat = v[0] * (180 / 2147483648), lon = v[1] * (180 / 2147483648);
          if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) {
            pts.push({ lat, lon, ele: alt != null ? alt / 5 - 500 : null, time: ts ? (ts + FIT_EPOCH) * 1000 : null });
          }
        }
      } else if (d.global === 18) { if (v[5] != null) sport = v[5]; if (v[6] != null) sub = v[6]; }
      else if (d.global === 12) { if (typeof v[3] === 'string' && v[3]) name = v[3]; if (sport == null && v[0] != null) sport = v[0]; if (sub == null && v[1] != null) sub = v[1]; }
    }
    o += d.size;
  }
  if (pts.length < 2) throw new Error('no contiene ningún track con posición GPS');
  // Pausas largas del reloj: tramo nuevo si pasan más de 10 min y más de 300 m entre dos puntos
  const segments = [[]];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[i - 1];
    if (q && p.time && q.time && p.time - q.time > 600000 && haversine(q.lat, q.lon, p.lat, p.lon) > 300) segments.push([]);
    segments[segments.length - 1].push(p);
  }
  const type = [FIT_SUBSPORT[sub], FIT_SPORT[sport]].filter(Boolean).join(' ');
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const t0 = pts.find((p) => p.time)?.time;
  const auto = /^\d[\d ]*$/.test(base) || !base;
  return [{
    name: auto ? `${name || 'Actividad'}${t0 ? ' del ' + new Date(t0).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}` : base,
    type, segments: segments.filter((s) => s.length), source: { kind: 'fit', file: fileName }, time: t0 ?? null,
  }];
}

/* ---------- Exportación ---------- */
function downloadBlob(text, name, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const fileSlug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'ruta';

/** Ruta del cuaderno → GPX 1.1 con el track (altitud y hora si las hay), las cumbres y los puntos marcados. */
function routeToGpx(r) {
  const P = r._P, x = esc;
  let wpts = '';
  for (const pe of r.peaks) {
    if (statusOf(r, pe) !== 'climbed') continue;
    wpts += `<wpt lat="${pe.la}" lon="${pe.lo}">${pe.e != null ? `<ele>${pe.e}</ele>` : ''}<name>${x(peakName(pe))}</name><sym>Summit</sym><type>Cumbre</type></wpt>\n`;
  }
  for (const w of (r.alp && r.alp.wps) || []) {
    const i = idxAt(P, w.at);
    wpts += `<wpt lat="${P.lat[i].toFixed(6)}" lon="${P.lon[i].toFixed(6)}">${P.ele ? `<ele>${P.ele[i].toFixed(1)}</ele>` : ''}<name>${x(w.name || WP_LABEL[w.kind] || 'Punto')}</name><type>${x(WP_LABEL[w.kind] || 'Punto')}</type></wpt>\n`;
  }
  let segs = '', cur = -1;
  for (let i = 0; i < P.n; i++) {
    if (P.seg[i] !== cur) { segs += (cur === -1 ? '' : '</trkseg>') + '<trkseg>'; cur = P.seg[i]; }
    segs += `<trkpt lat="${P.lat[i].toFixed(6)}" lon="${P.lon[i].toFixed(6)}">${P.ele ? `<ele>${P.ele[i].toFixed(1)}</ele>` : ''}${P.t ? `<time>${new Date(P.t[i] * 1000).toISOString()}</time>` : ''}</trkpt>\n`;
  }
  segs += '</trkseg>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cuaderno de cumbres" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(r.name)}</name>${r.date ? `<time>${r.date}</time>` : ''}</metadata>
${wpts}<trk><name>${x(r.name)}</name><type>${x(r.type)}</type>${segs}</trk>
</gpx>`;
}
function exportRouteGpx(id) {
  const r = S.routes.get(id);
  if (!r) return;
  downloadBlob(routeToGpx(r), `${fileSlug(r.name)}.gpx`, 'application/gpx+xml');
}
