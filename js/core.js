'use strict';
/* =============================================================================
   Cuaderno de cumbres
   Registro personal de rutas de montaña: GPX → estadísticas → cumbres OSM → mapa.

   Organización del código:
     0. Utilidades
     1. Datos de referencia (cumbres OSM, sierras GMBA, mapa base Natural Earth)
     2. Lectura de GPX
     3. Procesado de tracks (estadísticas, simplificado, huella, codificación)
     4. Detección de cumbres
     5. Fuentes de rutas → ingestRoutes()  ← único punto de entrada de rutas
     6. Almacenamiento (Claude db / IndexedDB / memoria)
     7. Estado y acciones
     8. Interfaz del cuaderno            (ui.js)
     9. Mapa: MapLibre 2D/3D y Leaflet   (map.js)
    10. Arranque                         (map.js)
    11. Sincronización con GitHub y Garmin (sync.js)
   ============================================================================= */

/* ============================== 0. Utilidades ============================== */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

function cyrb64(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const NF0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = {
  km: (m) => (m == null ? '—' : (m >= 100000 ? NF0.format(m / 1000) : NF1.format(m / 1000)) + ' km'),
  kmNum: (m) => (m == null ? '—' : m >= 100000 ? NF0.format(m / 1000) : NF1.format(m / 1000)),
  m: (m) => (m == null || !isFinite(m) ? '—' : NF0.format(Math.round(m)) + ' m'),
  num: (v) => (v == null || !isFinite(v) ? '—' : NF0.format(Math.round(v))),
  dur(s) {
    if (s == null || !isFinite(s)) return '—';
    let h = Math.floor(s / 3600), mi = Math.round((s % 3600) / 60);
    if (mi === 60) { h += 1; mi = 0; }
    return h ? `${h} h ${String(mi).padStart(2, '0')} min` : `${mi} min`;
  },
  date: (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Sin fecha'),
  dateLong: (iso) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha'),
  year: (iso) => (iso ? String(new Date(iso).getFullYear()) : ''),
  times: (n) => (n === 1 ? '1 vez' : `${n} veces`),
};
function listJoin(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}

/* Geodesia básica */
const toRad = (d) => (d * Math.PI) / 180;
const M_PER_DEG = 111320;
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* Datos de referencia: archivos .gz de data/, descomprimidos en el navegador */
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede descomprimir los datos incluidos (falta DecompressionStream).');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}
async function embedded(id) {
  const res = await fetch('data/' + id.replace(/^d-/, '') + '.gz');
  if (!res.ok) throw new Error('Faltan datos de la app: ' + id);
  const buf = await res.arrayBuffer();
  const u = new Uint8Array(buf);
  // Algunos servidores ya lo entregan descomprimido (Content-Encoding: gzip)
  return u[0] === 0x1f && u[1] === 0x8b ? gunzip(u) : buf;
}
const utf8 = new TextDecoder('utf-8');

/* Colores de track: tono estable derivado del id de la ruta */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + x(f(0)) + x(f(8)) + x(f(4));
}
function routeColor(id) {
  const h = parseInt(cyrb64(id).slice(0, 6), 16) % 360;
  // los amarillos se ven mal sobre papel: más oscuros
  const l = h > 40 && h < 75 ? 38 : 45;
  return hslToHex(h, 78, l);
}
