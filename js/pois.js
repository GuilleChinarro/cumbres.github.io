'use strict';
/* ===================== 15. Puntos de interés de OpenStreetMap (solo con conexión) =====================
   Lagunas, refugios, fuentes, collados y cascadas, consultados a Overpass por celdas de 0,25° y guardados
   en el navegador 30 días. También dan al planificador las salidas (refugios y aparcamientos), los sitios
   para dormir y el agua (fuentes, lagunas y arroyos con nombre). */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const POI_INFO = {
  laguna: { label: 'Laguna', col: '#2a7ab8', rank: 1 },
  refugio: { label: 'Refugio guardado', col: '#9a4f25', rank: 0 },
  libre: { label: 'Refugio libre o cabaña', col: '#9a4f25', rank: 0 },
  fuente: { label: 'Fuente o manantial', col: '#1d86c9', rank: 3 },
  collado: { label: 'Collado', col: '#5a5249', rank: 2 },
  cascada: { label: 'Cascada', col: '#2a7ab8', rank: 2 },
  parking: { label: 'Aparcamiento', col: '#3b4a6b', rank: 4 },
};
const POI_MAP_KINDS = ['laguna', 'refugio', 'libre', 'fuente', 'collado', 'cascada', 'parking'];
const fastDist = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * 111320 * Math.cos(toRad((lat1 + lat2) / 2)), (lat2 - lat1) * 110540);

function poiKind(t) {
  if (t.tourism === 'alpine_hut') return 'refugio';
  if (t.tourism === 'wilderness_hut' || t.amenity === 'shelter') return 'libre';
  if (t.natural === 'spring' || t.amenity === 'drinking_water' || t.man_made === 'water_tap') return 'fuente';
  if (t.natural === 'water') return t.water === 'reservoir' || t.landuse === 'reservoir' || /^embalse/i.test(t.name || '') ? null : 'laguna';
  if (t.mountain_pass === 'yes' || t.natural === 'saddle') return 'collado';
  if (t.waterway === 'waterfall') return 'cascada';
  if (t.amenity === 'parking') return t.access === 'private' ? null : 'parking';
  return null;
}

function poiCanvas(k) {
  const pr = Math.min(2, Math.ceil(window.devicePixelRatio || 1)), S = 18 * pr;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.scale(pr, pr);
  g.lineJoin = g.lineCap = 'round';
  const col = POI_INFO[k].col;
  const disc = (fill) => { g.beginPath(); g.arc(9, 9, 7.4, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#ffffff'; g.stroke(); };
  if (k === 'laguna') {
    disc(col);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(4.5, 9.5); g.quadraticCurveTo(6.75, 7, 9, 9.5); g.quadraticCurveTo(11.25, 12, 13.5, 9.5); g.stroke();
  } else if (k === 'fuente') {
    g.beginPath(); g.moveTo(9, 1.8); g.bezierCurveTo(12.5, 6.5, 14.6, 9.4, 14.6, 11.6); g.arc(9, 11.6, 5.6, 0, Math.PI); g.bezierCurveTo(3.4, 9.4, 5.5, 6.5, 9, 1.8);
    g.fillStyle = col; g.fill(); g.lineWidth = 1.4; g.strokeStyle = '#ffffff'; g.stroke();
  } else if (k === 'refugio' || k === 'libre') {
    g.beginPath(); g.moveTo(2.2, 9.4); g.lineTo(9, 2.6); g.lineTo(15.8, 9.4); g.lineTo(13.8, 9.4); g.lineTo(13.8, 15.4); g.lineTo(4.2, 15.4); g.lineTo(4.2, 9.4); g.closePath();
    g.fillStyle = k === 'refugio' ? col : '#ffffff'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = k === 'refugio' ? '#ffffff' : col; g.stroke();
  } else if (k === 'collado') {
    disc('#ffffff');
    g.strokeStyle = col; g.lineWidth = 1.7;
    g.beginPath(); g.moveTo(5, 4.5); g.quadraticCurveTo(8.6, 9, 5, 13.5); g.moveTo(13, 4.5); g.quadraticCurveTo(9.4, 9, 13, 13.5); g.stroke();
  } else if (k === 'cascada') {
    disc(col);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.4;
    g.beginPath(); for (const x of [6.5, 9, 11.5]) { g.moveTo(x, 5); g.lineTo(x, 13); } g.stroke();
  } else {
    g.fillStyle = col; g.fillRect(2.5, 2.5, 13, 13);
    g.fillStyle = '#ffffff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 9, 9.6);
  }
  return c;
}
const poiImage = (k) => { const c = poiCanvas(k); return c.getContext('2d').getImageData(0, 0, c.width, c.height); };
const poiUrlCache = {};
const poiUrl = (k) => poiUrlCache[k] || (poiUrlCache[k] = poiCanvas(k).toDataURL());

function poiPopup(p) {
  const info = POI_INFO[p.k] || { label: 'Lugar' };
  const water = p.k === 'fuente'
    ? `<p class="small" style="margin:6px 0 0">${p.np ? 'Marcada como no potable: filtra o trata el agua.' : 'Puede secarse en verano; si dudas, filtra el agua.'}</p>`
    : p.k === 'laguna' ? '<p class="small" style="margin:6px 0 0">Agua para coger con filtro.</p>' : '';
  const osm = String(p.id || '');
  const type = { n: 'node', w: 'way', r: 'relation' }[osm[0]];
  return `<div class="pp"><b>${esc(p.n || info.label)}</b><div class="small muted">${info.label}${p.e ? `, ${fmt.num(p.e)} m` : ''}</div>${water}
    ${type ? `<a class="small" href="https://www.openstreetmap.org/${type}/${osm.slice(1)}" target="_blank" rel="noopener">Ver en OpenStreetMap</a>` : ''}</div>`;
}

const Pois = {
  mem: new Map(), pending: new Map(), shown: [], busy: false,
  on: (() => { try { return localStorage.getItem('cc-pois') !== '0'; } catch { return true; } })(),
  available() { return !!Net.online; },
  keysFor(b) {
    const out = [];
    for (let a = Math.floor(b[1] * 4); a <= Math.floor(b[3] * 4); a++) for (let o = Math.floor(b[0] * 4); o <= Math.floor(b[2] * 4); o++) out.push(a + ':' + o);
    return out;
  },
  async fetchCell(key) {
    const [a, o] = key.split(':').map(Number);
    const s = a / 4, w = o / 4;
    const q = `[out:json][timeout:60][bbox:${s},${w},${s + 0.25},${w + 0.25}];
(nwr["tourism"~"^(alpine_hut|wilderness_hut)$"];nwr["amenity"="shelter"]["name"];nwr["amenity"="parking"];node["natural"="spring"];nwr["amenity"="drinking_water"];node["man_made"="water_tap"];nwr["natural"="water"]["name"];node["mountain_pass"="yes"]["name"];node["natural"="saddle"]["name"];node["waterway"="waterfall"]["name"];);
out tags center qt;
way["waterway"="stream"]["name"];
out geom qt;`;
    return this.parse(await this.overpass(q));
  },
  async overpass(q) {
    let err;
    for (const url of OVERPASS) {
      try {
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!res.ok) throw new Error('Overpass respondió ' + res.status);
        return await res.json();
      } catch (e) { err = e; }
    }
    throw err;
  },
  /** Carreteras y pistas abiertas al coche de una zona, para dejar el coche donde mejor convenga. */
  async roads(b) {
    const q = `[out:json][timeout:60][bbox:${b[1]},${b[0]},${b[3]},${b[2]}];
(way["highway"~"^(trunk|primary|secondary|tertiary|unclassified)$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"];
way["highway"="track"]["motor_vehicle"~"^(yes|permissive|destination)$"];
way["highway"="track"]["access"~"^(yes|permissive)$"]["motor_vehicle"!~"^(no|private|forestry|agricultural)$"];);
out geom qt;`;
    const j = await this.overpass(q);
    return (j.elements || []).filter((el) => el.geometry && el.geometry.length > 1).map((el) => {
      const t = el.tags || {};
      return { n: t.ref && t.name ? `${t.ref} (${t.name})` : t.ref || t.name || '', hw: t.highway, c: el.geometry.map((g) => [g.lon, g.lat]) };
    });
  },
  parse(j) {
    const items = [], streams = [];
    for (const el of j.elements || []) {
      const t = el.tags || {};
      if (el.type === 'way' && t.waterway === 'stream') {
        if (el.geometry && el.geometry.length > 1) streams.push({ n: t.name, c: el.geometry.filter((_, i, a) => i % 3 === 0 || i === a.length - 1).map((g) => [+g.lon.toFixed(5), +g.lat.toFixed(5)]) });
        continue;
      }
      const k = poiKind(t);
      if (!k) continue;
      const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
      if (lat == null) continue;
      const it = { id: el.type[0] + el.id, k, n: t.name || '', lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
      const e = parseFloat(t.ele);
      if (e > 0) it.e = Math.round(e);
      if (t.drinking_water === 'no' || t.drinking_water === 'conditional') it.np = 1;
      if (el.bounds) it.r = Math.round(fastDist(el.bounds.minlat, el.bounds.minlon, el.bounds.maxlat, el.bounds.maxlon) / 2);
      items.push(it);
    }
    return { items, streams };
  },
  store(key, d) {
    const v = JSON.stringify({ t: Date.now(), d });
    for (let i = 0; i < 8; i++) {
      try { localStorage.setItem('cc-poi2:' + key, v); return; } catch {
        const old = Object.keys(localStorage).filter((k) => k.startsWith('cc-poi2:')).map((k) => [k, (JSON.parse(localStorage.getItem(k) || '{}').t || 0)]).sort((a, b) => a[1] - b[1]);
        if (!old.length) return;
        localStorage.removeItem(old[0][0]);
      }
    }
  },
  cell(key) {
    if (this.mem.has(key)) return Promise.resolve(this.mem.get(key));
    if (this.pending.has(key)) return this.pending.get(key);
    try {
      const raw = localStorage.getItem('cc-poi2:' + key);
      if (raw) {
        const o = JSON.parse(raw);
        if (Date.now() - o.t < 30 * 864e5) { this.mem.set(key, o.d); return Promise.resolve(o.d); }
      }
    } catch {}
    const p = this.fetchCell(key)
      .then((d) => { this.mem.set(key, d); this.store(key, d); return d; })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  },
  /** Todos los puntos de una zona (en serie, para respetar el uso justo de Overpass). */
  async area(b, maxCells = 12) {
    const keys = this.keysFor(b);
    if (keys.length > maxCells) throw new Error('La zona es demasiado grande: acerca el mapa.');
    const seen = new Set(), items = [], streams = [];
    for (const k of keys) {
      const d = await this.cell(k);
      for (const it of d.items) if (!seen.has(it.id)) { seen.add(it.id); items.push(it); }
      streams.push(...d.streams);
    }
    return { items, streams };
  },
  /** Carga las celdas de la vista (las 9 más cercanas al centro) y las pinta según llegan. */
  async refresh() {
    const v = MapCtl.view;
    if (!v || !v.setPois) return;
    if (!this.on || !this.available() || v.map.getZoom() < 10.5) { v.setPois([]); return; }
    const b = v.map.getBounds(), c = v.map.getCenter(), seq = (this.seq = (this.seq || 0) + 1);
    const keys = this.keysFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      .map((k) => { const [a, o] = k.split(':').map(Number); return [k, Math.hypot((o / 4 + 0.125 - c.lng) * Math.cos(toRad(c.lat)), a / 4 + 0.125 - c.lat)]; })
      .sort((x, y) => x[1] - y[1]).slice(0, 9).map((x) => x[0]);
    const paint = () => {
      if (seq !== this.seq) return;
      const seen = new Set(), items = [];
      for (const k of keys) { const d = this.mem.get(k); if (d) for (const it of d.items) if (!seen.has(it.id) && POI_MAP_KINDS.includes(it.k)) { seen.add(it.id); items.push(it); } }
      this.shown = items;
      v.setPois(items);
    };
    paint();
    let i = 0;
    const worker = async () => {
      while (i < keys.length) {
        const k = keys[i++];
        if (this.mem.has(k)) continue;
        try { await this.cell(k); paint(); } catch (e) { this.fail(e); }
      }
    };
    await Promise.all([worker(), worker()]);
  },
  fail(e) {
    console.warn('Lugares de interés:', e);
    if (this.warned) return;
    this.warned = true;
    UI.toast(`No se pudieron cargar los lugares de interés de OpenStreetMap (${(e && e.message) || e}). Lo reintentaré al mover el mapa.`, { err: true, timeout: 9000 });
  },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('cc-pois', this.on ? '1' : '0'); } catch {}
    this.refresh();
    MapCtl.updateControls();
  },
};
