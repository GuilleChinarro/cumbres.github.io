'use strict';
/* ===================== 2. Lectura de GPX ===================== */
function childText(el, name) {
  for (const c of el.children) if (c.localName === name) return c.textContent.trim();
  return null;
}
function readPoints(parent, tag) {
  const pts = [];
  for (const el of parent.children) {
    if (el.localName !== tag) continue;
    const lat = parseFloat(el.getAttribute('lat')), lon = parseFloat(el.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    let ele = null, time = null;
    for (const c of el.children) {
      if (c.localName === 'ele') { const v = parseFloat(c.textContent); if (isFinite(v)) ele = v; }
      else if (c.localName === 'time') { const t = Date.parse(c.textContent.trim()); if (isFinite(t)) time = t; }
    }
    pts.push({ lat, lon, ele, time });
  }
  return pts;
}
/** GPX → rutas normalizadas (una por <trk>; si no hay, una por <rte>). */
function parseGpx(text, fileName = '') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement || doc.documentElement.localName !== 'gpx') {
    throw new Error('no es un GPX válido');
  }
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  const meta = doc.getElementsByTagNameNS('*', 'metadata')[0];
  const metaName = meta ? childText(meta, 'name') : null;
  const metaTimeTxt = meta ? childText(meta, 'time') : null;
  const metaTime = metaTimeTxt && isFinite(Date.parse(metaTimeTxt)) ? Date.parse(metaTimeTxt) : null;
  const out = [];
  for (const trk of doc.getElementsByTagNameNS('*', 'trk')) {
    const segments = [];
    for (const seg of trk.children) if (seg.localName === 'trkseg') { const p = readPoints(seg, 'trkpt'); if (p.length) segments.push(p); }
    if (!segments.length) continue;
    out.push({ name: childText(trk, 'name') || metaName || base, type: childText(trk, 'type'), segments, source: { kind: 'gpx', file: fileName }, time: metaTime });
  }
  if (!out.length) {
    for (const rte of doc.getElementsByTagNameNS('*', 'rte')) {
      const p = readPoints(rte, 'rtept');
      if (p.length > 1) out.push({ name: childText(rte, 'name') || metaName || base, type: childText(rte, 'type'), segments: [p], source: { kind: 'gpx', file: fileName }, time: metaTime });
    }
  }
  if (!out.length) throw new Error('no contiene ningún track');
  return out;
}

const TYPES = [
  ['senderismo', 'Senderismo'], ['montanismo', 'Montañismo'], ['alpinismo', 'Alpinismo'], ['trail', 'Trail running'],
  ['carrera', 'Carrera'], ['raquetas', 'Raquetas de nieve'], ['esqui', 'Esquí de montaña'], ['escalada', 'Escalada'],
  ['btt', 'Bicicleta de montaña'], ['paseo', 'Paseo'], ['otro', 'Otro'],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
function mapType(raw, name) {
  const t = norm(raw || '');
  const table = [
    [/trail|mountain_run|trailrun/, 'trail'], [/mountaineer|alpin/, 'alpinismo'], [/backcountry|ski|esqui/, 'esqui'],
    [/snow_?shoe|raquet/, 'raquetas'], [/climb|escalad/, 'escalada'], [/bik|cycl|mtb|btt|bici/, 'btt'],
    [/hik|sender|trek/, 'senderismo'], [/^run|running|carrera/, 'carrera'], [/walk|paseo|camin/, 'paseo'],
    [/montan/, 'montanismo'],
  ];
  for (const [re, v] of table) if (t && re.test(t)) return v;
  const n = norm(name || '');
  for (const [re, v] of table) if (re.test(n)) return v;
  return 'senderismo';
}
