'use strict';
/* ===================== 16. Planificador de rutas para completar retos =====================
   Con las cumbres pendientes de un reto en la zona del mapa, busca la combinación que cabe en las horas
   de marcha (problema de orientación: inserción voraz con azar + 2-opt), estimando los tiempos campo a
   través sobre el relieve con el método MIDE. Para varios días elige dónde dormir (refugios, o lagunas,
   fuentes y refugios libres para el vivac). Después traza cada tramo por sendero con BRouter (perfil de
   montaña) o en línea recta si no hay un camino razonable, y señala el agua cercana al trazado. */
const PLAN_ROUTER = 'https://brouter.de/brouter';
const PLAN_COLORS = ['#6d3fc0', '#0f8b8d', '#d9730d', '#c2185b', '#2e7d32'];
const PLAN_PACES = [['tranquilo', 'Tranquilo', 1.2], ['normal', 'Normal', 1], ['rapido', 'Rápido', 0.85]];
const planSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtHours = (h) => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const fmtKm1 = (m) => (m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** Relieve para el planificador: teselas de Mapterhorn (z11-z12) decodificadas a altitudes. */
const PlanDem = {
  z: 12, tiles: new Map(),
  async ensure(b) {
    this.z = Math.max(b[2] - b[0], b[3] - b[1]) > 0.45 ? 11 : 12;
    const [x0, y0] = tileXY(b[0], b[3], this.z), [x1, y1] = tileXY(b[2], b[1], this.z);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) throw new Error('La zona es demasiado grande: acerca el mapa y vuelve a abrir el planificador.');
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) if (!this.tiles.has(`${this.z}/${x}/${y}`)) jobs.push([x, y]);
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const [x, y] = jobs[i++];
        let t = null;
        try { t = await this.load(this.z, x, y); } catch {}
        this.tiles.set(`${this.z}/${x}/${y}`, t);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  },
  async load(z, x, y) {
    const r = await fetch(DEMS.mapterhorn.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
    if (!r.ok) throw new Error('relieve ' + r.status);
    const bmp = await createImageBitmap(await r.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, E = new Float32Array(W * c.height);
    for (let i = 0, j = 0; i < E.length; i++, j += 4) E[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
    return { W, H: c.height, E };
  },
  ele(lon, lat) {
    const n = 2 ** this.z, la = toRad(clamp(lat, -85, 85));
    const fx = ((lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n;
    const t = this.tiles.get(`${this.z}/${Math.floor(fx)}/${Math.floor(fy)}`);
    if (!t) return null;
    const px = (fx % 1) * t.W - 0.5, py = (fy % 1) * t.H - 0.5;
    const x0 = clamp(Math.floor(px), 0, t.W - 2), y0 = clamp(Math.floor(py), 0, t.H - 2);
    const tx = clamp(px - x0, 0, 1), ty = clamp(py - y0, 0, 1), E = t.E, i = y0 * t.W + x0;
    return (E[i] * (1 - tx) + E[i + 1] * tx) * (1 - ty) + (E[i + t.W] * (1 - tx) + E[i + t.W + 1] * tx) * ty;
  },
  /** Pendiente media (grados) en unos 40 m alrededor del punto. */
  slope(lon, lat) {
    const d = 0.0004, f = (a, b) => this.ele(a, b);
    if (f(lon, lat) == null) return null;
    const ex = (f(lon + d, lat) - f(lon - d, lat)) / (2 * d * 111320 * Math.cos(toRad(lat)));
    const ey = (f(lon, lat + d) - f(lon, lat - d)) / (2 * d * 110540);
    return (Math.atan(Math.hypot(ex, ey)) * 180) / Math.PI;
  },
};

function planDensify(coords, step) {
  const out = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], n = Math.max(1, Math.ceil(fastDist(a[1], a[0], b[1], b[0]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
/** Distancia, desnivel y metros muy empinados (>50°) de una línea, leyendo el relieve. */
function planProfile(coords) {
  let d = 0, up = 0, down = 0, steep = 0, pe = null, pp = null;
  for (const c of planDensify(coords, 40)) {
    const e = PlanDem.ele(c[0], c[1]);
    if (pp) {
      const s = fastDist(pp[1], pp[0], c[1], c[0]);
      d += s;
      if (e != null && pe != null) {
        const dz = e - pe;
        if (dz > 0) up += dz; else down -= dz;
        if (s > 0 && Math.abs(dz) / s > 1.2) steep += s;
      }
    }
    pp = c;
    if (e != null) pe = e;
  }
  return { d, up, down, steep };
}
/** Horas por el método MIDE (sin paradas); campo a través, algo más lento. */
function planMide(dist, up, down, off, pace) {
  const th = dist / 1000 / (off ? 3 : 4), tv = up / (off ? 350 : 400) + down / (off ? 500 : 600);
  return (Math.max(th, tv) + Math.min(th, tv) / 2) * pace;
}
function planTwoOpt(A, B, seq, M) {
  let route = [A, ...seq, B];
  const len = (r) => { let s = 0; for (let i = 1; i < r.length; i++) s += M(r[i - 1], r[i]); return s; };
  let best = len(route), improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 2; i++) for (let k = i + 1; k < route.length - 1; k++) {
      const r2 = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
      const l2 = len(r2);
      if (l2 < best - 1e-6) { route = r2; best = l2; improved = true; }
    }
  }
  return { seq: route.slice(1, -1), t: best };
}
/** Máximo de cumbres entre A y B sin pasar de T horas. Devuelve null si ni siquiera da para ir de A a B. */
function planSolveOP(A, B, C, T, M, iters) {
  if (M(A, B) > T) return null;
  let best = { seq: [], t: M(A, B) };
  for (let r = 0; r < iters; r++) {
    let seq = [], t = M(A, B);
    const pool = new Set(C);
    const fill = () => {
      for (;;) {
        const cands = [];
        const route = [A, ...seq, B];
        for (const c of pool) {
          let bi = 0, bd = Infinity;
          for (let k = 0; k < route.length - 1; k++) {
            const d = M(route[k], c) + M(c, route[k + 1]) - M(route[k], route[k + 1]);
            if (d < bd) { bd = d; bi = k; }
          }
          if (t + bd <= T) cands.push([bd, c, bi]);
        }
        if (!cands.length) return;
        cands.sort((a, b) => a[0] - b[0]);
        const pick = cands[r === 0 ? 0 : Math.floor(Math.random() * Math.min(3, cands.length))];
        seq.splice(pick[2], 0, pick[1]);
        t += pick[0];
        pool.delete(pick[1]);
      }
    };
    fill();
    ({ seq, t } = planTwoOpt(A, B, seq, M));
    for (const p of seq) pool.delete(p);
    fill();
    if (seq.length > best.seq.length || (seq.length === best.seq.length && t < best.t)) best = { seq, t };
  }
  return best;
}
/** Puntos de carreteras y pistas desde los que hay más cumbres pendientes cerca (separados al menos 1,5 km). */
function planRoadPoints(roads, peaks, R, max) {
  const pts = [];
  for (const r of roads) for (const c of planDensify(r.c, 250)) {
    let score = 0, best = Infinity, nm = '';
    for (const p of peaks) {
      const d = fastDist(c[1], c[0], p.lat, p.lon);
      if (d < R) score += 1 - d / R;
      if (d < best) { best = d; nm = p.name; }
    }
    if (score > 0) pts.push({ lon: c[0], lat: c[1], score, road: r.n, hw: r.hw, nm, d: best });
  }
  pts.sort((a, b) => b.score - a.score);
  const out = [];
  for (const p of pts) {
    if (out.length >= max) break;
    if (!out.some((q) => fastDist(p.lat, p.lon, q.lat, q.lon) < 1500)) out.push(p);
  }
  return out;
}
/** Varios días: cada día acaba en un sitio para dormir y el último vuelve a la salida. */
function planTrip(S0, cands, nights, D, T, M) {
  const days = [], left = new Set(cands);
  let pos = S0;
  for (let d = 1; d <= D; d++) {
    const toStart = () => { const r = planSolveOP(pos, S0, [...left], T, M, 40); days.push({ from: pos, to: S0, seq: r ? r.seq : [] }); };
    if (d === D) { toStart(); break; }
    let best = null;
    for (const o of nights) {
      if (o === pos || M(pos, o) > T || M(o, S0) > T * (D - d)) continue;
      const r = planSolveOP(pos, o, [...left], T, M, 8);
      if (!r) continue;
      let look = 0;
      for (const p of left) if (!r.seq.includes(p) && M(o, p) <= T * 0.3) look++;
      const score = r.seq.length + 0.35 * look - 0.02 * r.t + (o.water ? 0.3 : 0);
      if (!best || score > best.score) best = { o, r, score };
    }
    if (!best) { toStart(); break; }
    days.push({ from: pos, to: best.o, seq: best.r.seq });
    for (const p of best.r.seq) left.delete(p);
    pos = best.o;
  }
  return days;
}

const Planner = {
  st: null,
  open(retoId) {
    const r = RETOS.find((x) => x.id === retoId), m = MapCtl.view && MapCtl.view.map;
    if (!r || !m) return;
    const b = m.getBounds(), bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const peaks = retoItems(r).filter((it) => retoStatus(it.id) !== 'climbed' && it.lon >= bbox[0] && it.lon <= bbox[2] && it.lat >= bbox[1] && it.lat <= bbox[3]);
    this.st = { reto: r, bbox, peaks, starts: null, roads: [], roadPts: [], startsErr: '', startId: 'auto', start: null, mode: 'dia', days: 2, hours: 8, pace: 'normal', busy: '', error: '', res: null, pois: null };
    UI.saveScroll();
    S.ui.view = 'plan';
    UI.render();
    UI.body.scrollTop = 0;
    if (MapCtl.view.setPlan) MapCtl.view.setPlan(null);
    if (peaks.length) this.loadStarts();
  },
  async loadStarts() {
    const st = this.st;
    if (!Pois.available()) { st.starts = []; st.startsErr = 'Sin conexión no puedo buscar refugios ni aparcamientos: marca la salida en el mapa.'; UI.render(); return; }
    try {
      const [w, s, e, n] = st.bbox;
      st.pois = await Pois.area([w - 0.05, s - 0.05, e + 0.05, n + 0.05], 20);
      st.starts = this.startOptions(st.pois.items);
      try { st.roads = await Pois.roads([w - 0.08, s - 0.08, e + 0.08, n + 0.08]); } catch (err) { console.warn('Carreteras:', err); st.roads = []; }
      st.roadPts = planRoadPoints(st.roads, st.peaks, 6000, 6).map((p) => this.roadStart(p));
      if (!st.starts.length && !st.roadPts.length) st.startsErr = 'No encuentro carreteras, refugios ni aparcamientos cerca: marca la salida en el mapa.';
    } catch (e) {
      st.starts = [];
      st.startsErr = `No pude cargar refugios y aparcamientos (${(e && e.message) || e}). Puedes marcar la salida en el mapa.`;
    }
    if (this.st === st && S.ui.view === 'plan') UI.render();
  },
  startOptions(items) {
    const P = this.st.peaks;
    const near = (it) => { let best = Infinity, nm = ''; for (const p of P) { const d = fastDist(it.lat, it.lon, p.lat, p.lon); if (d < best) { best = d; nm = p.name; } } return [best, nm]; };
    const opts = items.filter((it) => ['refugio', 'libre', 'parking'].includes(it.k)).map((it) => { const [d, nm] = near(it); return { ...it, d, nm }; }).filter((it) => it.d < 9000);
    const huts = opts.filter((it) => it.k !== 'parking').sort((a, b) => a.d - b.d).slice(0, 10);
    const parks = [];
    for (const p of opts.filter((it) => it.k === 'parking').sort((a, b) => a.d - b.d)) {
      if (parks.length >= 10) break;
      if (parks.some((q) => fastDist(p.lat, p.lon, q.lat, q.lon) < 600)) continue;
      parks.push(p);
    }
    return [...huts, ...parks].map((it) => ({
      id: it.id, k: it.k, lat: it.lat, lon: it.lon,
      n: it.n || (it.k === 'parking' ? `Aparcamiento cerca de ${it.nm}` : `Refugio cerca de ${it.nm}`),
      label: `${it.k === 'parking' ? 'Aparcamiento' : it.k === 'refugio' ? 'Refugio' : 'Refugio libre'}: ${it.n || `cerca de ${it.nm}`} (a ${fmt.km(it.d)} de la cumbre pendiente más cercana)`,
    }));
  },
  roadStart(p) {
    const kind = p.hw === 'track' ? 'pista' : 'carretera';
    const what = p.road ? (/^(pista|carretera|camino)\b/i.test(p.road) ? p.road.replace(/^\w/, (c) => c.toLowerCase()) : `${kind} ${p.road}`) : kind === 'pista' ? 'una pista' : 'la carretera';
    return { id: `road:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, k: 'road', lat: p.lat, lon: p.lon, n: `${what}, cerca de ${p.nm}`,
      label: `${what[0].toUpperCase()}${what.slice(1)}, cerca de ${p.nm} (a ${fmt.km(p.d)})` };
  },
  set(key, v) {
    const st = this.st;
    if (!st) return;
    if (key === 'start') {
      st.startId = v;
      st.start = v === 'auto' ? null : [...(st.starts || []), ...(st.roadPts || [])].find((s) => s.id === v) || (v === 'mapa' ? st.start : null);
      if (st.start) MapCtl.setCursor(st.start.lat, st.start.lon);
    } else if (key === 'days' || key === 'hours') st[key] = +v;
    else st[key] = v;
    UI.render();
  },
  pick() {
    S.ui.placing = 'plan-start';
    document.body.classList.add('placing');
    MapCtl.note('<b>Marca la salida.</b> Pulsa en el mapa donde quieres empezar. <button class="link" type="button" data-act="cancel-place">Cancelar</button>', true);
    if (isMobile()) UI.pane('map');
  },
  placed(lat, lon) {
    S.ui.placing = null;
    document.body.classList.remove('placing');
    MapCtl.restoreNote();
    if (!this.st) return;
    this.st.start = { id: 'mapa', k: 'punto', lat, lon, n: 'el punto marcado' };
    this.st.startId = 'mapa';
    MapCtl.setCursor(lat, lon);
    UI.render();
    if (isMobile()) UI.pane('panel');
  },

  view() {
    const st = this.st;
    if (!st) return '';
    const btn = (v, l) => `<button type="button" data-act="plan-mode" data-id="${v}" aria-pressed="${st.mode === v}">${l}</button>`;
    const sel = st.starts == null
      ? '<p class="small muted" style="margin:0">Buscando refugios y aparcamientos de la zona…</p>'
      : (() => {
        const opt = (s) => `<option value="${esc(s.id)}"${st.startId === s.id ? ' selected' : ''}>${esc(s.label)}</option>`;
        const grp = (label, list) => (list.length ? `<optgroup label="${label}">${list.map(opt).join('')}</optgroup>` : '');
        return `<select data-plan="start" aria-label="Salida">
          <option value="auto"${st.startId === 'auto' ? ' selected' : ''}>Donde mejor convenga dejar el coche (lo elige el planificador)</option>
          ${grp('Dejar el coche en una carretera o pista', st.roadPts || [])}
          ${grp('Aparcamientos', st.starts.filter((s) => s.k === 'parking'))}
          ${grp('Refugios', st.starts.filter((s) => s.k !== 'parking'))}
          ${st.startId === 'mapa' ? '<option value="mapa" selected>Punto marcado en el mapa</option>' : ''}
        </select>
        ${st.startId === 'auto' ? '<p class="small muted" style="margin:0">Prueba varios puntos de carreteras, pistas y aparcamientos cercanos y se queda con el que permite más cumbres.</p>' : ''}`;
      })();
    const intro = st.peaks.length
      ? `En la zona que ves en el mapa te quedan <b>${st.peaks.length}</b> ${st.peaks.length === 1 ? 'cumbre' : 'cumbres'} de este reto. Para planificar en otra zona, mueve el mapa y vuelve a abrir el planificador.`
      : 'En la zona que ves en el mapa no te queda ninguna cumbre de este reto. Mueve el mapa a otra zona y vuelve a abrir el planificador.';
    return `<div class="detail plan">
      <div class="d-head">
        <button class="btn quiet small back" type="button" data-act="back">‹ ${esc(st.reto.name)}</button>
        <h2 class="reto-title">Planificar una ruta</h2>
        <p class="small muted" style="margin:4px 0 0">${intro}</p>
      </div>
      ${st.peaks.length ? `<div class="plan-form">
        <div class="fld"><span>Salida</span>${sel}</div>
        ${st.startsErr ? `<p class="small muted" style="margin:0">${esc(st.startsErr)}</p>` : ''}
        <div><button class="btn small" type="button" data-act="plan-pick">Marcar la salida en el mapa</button></div>
        <div class="fld"><span>Cómo</span><div class="seg" role="group" aria-label="Tipo de salida">${btn('dia', 'En el día')}${btn('refugios', 'Con refugios')}${btn('vivac', 'Con vivac')}</div></div>
        <div class="plan-row">
          ${st.mode !== 'dia' ? `<label class="fld"><span>Días</span><select data-plan="days">${[2, 3, 4, 5].map((d) => `<option value="${d}"${st.days === d ? ' selected' : ''}>${d}</option>`).join('')}</select></label>` : ''}
          <label class="fld"><span>Horas de marcha al día</span><select data-plan="hours">${[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((h) => `<option value="${h}"${st.hours === h ? ' selected' : ''}>${h} h</option>`).join('')}</select></label>
          <label class="fld"><span>Ritmo</span><select data-plan="pace">${PLAN_PACES.map(([v, l]) => `<option value="${v}"${st.pace === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div><button class="btn primary" type="button" data-act="plan-run"${st.busy ? ' disabled' : ''}>${st.busy ? esc(st.busy) : 'Calcular la ruta'}</button></div>
        ${st.error ? `<p class="plan-err">${esc(st.error)}</p>` : ''}
      </div>` : ''}
      ${st.res ? this.resultHtml() : ''}
    </div>`;
  },

  async run() {
    const st = this.st;
    if (!st || st.busy) return;
    if (!st.start && st.startId !== 'auto') { st.error = 'Elige un punto de salida o márcalo en el mapa.'; UI.render(); return; }
    st.error = ''; st.res = null;
    if (MapCtl.view.setPlan) MapCtl.view.setPlan(null);
    const pace = PLAN_PACES.find((p) => p[0] === st.pace)[2], T = st.hours, D = st.mode === 'dia' ? 1 : st.days;
    const step = async (msg) => { st.busy = msg; UI.render(); await planSleep(30); };
    try {
      const reach = st.mode === 'dia' ? (T / 2) * 3300 : D * T * 2300;
      let starts = [st.start];
      if (st.startId === 'auto') {
        starts = [...planRoadPoints(st.roads || [], st.peaks, Math.min(reach, 9000), 5).map((p) => this.roadStart(p)), ...(st.starts || []).filter((s) => s.k === 'parking').slice(0, 3)];
        if (!starts.length) throw new Error('No encuentro carreteras, pistas ni aparcamientos cerca de tus cumbres pendientes: marca la salida en el mapa.');
      }
      const SS = starts.map((s) => ({ lat: s.lat, lon: s.lon, n: s.n, k: s.k }));
      const dmin = (lat, lon) => Math.min(...SS.map((s) => fastDist(s.lat, s.lon, lat, lon)));
      const cands = st.peaks.map((p) => ({ lat: p.lat, lon: p.lon, n: p.name, e: p.ele, tag: p.tag, d0: dmin(p.lat, p.lon) }))
        .filter((p) => p.d0 <= reach).sort((a, b) => a.d0 - b.d0).slice(0, 70);
      if (!cands.length) throw new Error('Desde esa salida no hay cumbres pendientes a una distancia razonable. Prueba otra salida o más horas.');
      let nights = [];
      if (D > 1) {
        const items = (st.pois && st.pois.items) || [];
        const ok = st.mode === 'refugios' ? ['refugio', 'libre'] : ['laguna', 'fuente', 'libre'];
        nights = items.filter((it) => ok.includes(it.k))
          .map((it) => ({ lat: it.lat, lon: it.lon, k: it.k, n: it.n || `${POI_INFO[it.k].label.toLowerCase()} sin nombre`, water: it.k === 'laguna' || it.k === 'fuente' || it.k === 'refugio', d0: dmin(it.lat, it.lon) }))
          .filter((n) => n.d0 <= reach).sort((a, b) => a.d0 - b.d0).slice(0, 30);
        if (!nights.length) throw new Error(st.mode === 'refugios' ? 'No encuentro refugios en la zona. Prueba con vivac o en el día.' : 'No encuentro sitios para el vivac (lagunas, fuentes o refugios libres) en la zona.');
      }
      await step('Cargando el relieve…');
      const all = [...SS, ...cands, ...nights];
      all.forEach((p, i) => { p.i = i; });
      await PlanDem.ensure([Math.min(...all.map((p) => p.lon)) - 0.02, Math.min(...all.map((p) => p.lat)) - 0.02, Math.max(...all.map((p) => p.lon)) + 0.02, Math.max(...all.map((p) => p.lat)) + 0.02]);
      if (st.mode === 'vivac') nights = nights.filter((n) => n.k === 'laguna' || (PlanDem.slope(n.lon, n.lat) ?? 0) < 18);
      await step(SS.length > 1 ? 'Probando dónde dejar el coche…' : 'Buscando la combinación con más cumbres…');
      const N = all.length, mat = new Float64Array(N * N).fill(-1);
      const M = (a, b) => {
        const k = a.i * N + b.i;
        if (mat[k] < 0) {
          const s = planProfile([[a.lon, a.lat], [b.lon, b.lat]]);
          mat[k] = a === b ? 0 : planMide(s.d, s.up, s.down, true, pace) * (1 + Math.min(2, s.steep / 150));
        }
        return mat[k];
      };
      const plannedCost = (d) => { const r = [d.from, ...d.seq, d.to]; let t = 0; for (let i = 1; i < r.length; i++) t += M(r[i - 1], r[i]); return t; };
      let best = null;
      for (const s of SS) {
        let ds;
        if (D === 1) { const r = planSolveOP(s, s, cands, T, M, SS.length > 1 ? 25 : 60); ds = [{ from: s, to: s, seq: r ? r.seq : [] }]; }
        else ds = planTrip(s, cands, nights, D, T, M);
        const count = ds.reduce((a, d) => a + d.seq.length, 0), cost = ds.reduce((a, d) => a + plannedCost(d), 0);
        if (!best || count > best.count || (count === best.count && cost < best.cost)) best = { s, ds, count, cost };
      }
      const S0 = best.s, days = best.ds;
      if (!best.count) throw new Error(`Con ${T} h de marcha al día no llegas a ninguna cumbre pendiente desde ${SS.length > 1 ? 'las salidas cercanas' : 'esa salida'}. Prueba más horas u otra salida.`);
      this.legs = new Map(); this.routerErrors = 0; this.noRouter = false;
      for (let i = 0; i < days.length; i++) {
        await step(`Trazando por senderos el día ${i + 1} de ${days.length}…`);
        await this.buildDay(days[i], T, pace, M);
      }
      this.addWater(days, st.pois);
      const left = st.peaks.length - days.reduce((a, d) => a + d.seq.length, 0);
      st.res = { days, left, noRouter: this.noRouter, mode: st.mode, start: S0, tried: SS.length };
      st.busy = '';
      UI.render();
      this.show(true);
      if (isMobile()) UI.pane('map');
    } catch (e) {
      console.error(e);
      st.busy = '';
      st.error = (e && e.message) || String(e);
      UI.render();
    }
  },
  /** Un tramo: por sendero si BRouter encuentra un camino razonable; si no, en línea recta. */
  async routeLeg(a, b) {
    const key = `${a.lat},${a.lon}>${b.lat},${b.lon}`;
    if (this.legs.has(key)) return this.legs.get(key);
    const D = fastDist(a.lat, a.lon, b.lat, b.lon);
    let out = [{ c: [[a.lon, a.lat], [b.lon, b.lat]], off: true }];
    if (D > 150 && !this.noRouter) {
      try {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);
        const url = `${PLAN_ROUTER}?lonlats=${a.lon.toFixed(6)},${a.lat.toFixed(6)}|${b.lon.toFixed(6)},${b.lat.toFixed(6)}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
        const res = await fetch(url, { signal: ctl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error('BRouter ' + res.status);
        const f = (await res.json()).features[0];
        const cs = f.geometry.coordinates.map((c) => [c[0], c[1]]);
        let L = +f.properties['track-length'];
        if (!(L > 0)) { L = 0; for (let i = 1; i < cs.length; i++) L += fastDist(cs[i - 1][1], cs[i - 1][0], cs[i][1], cs[i][0]); }
        const dA = fastDist(a.lat, a.lon, cs[0][1], cs[0][0]), dB = fastDist(b.lat, b.lon, cs[cs.length - 1][1], cs[cs.length - 1][0]);
        if (cs.length > 1 && L + dA + dB <= Math.max(2.2 * D, D + 2500)) {
          out = [];
          if (dA > 40) out.push({ c: [[a.lon, a.lat], cs[0]], off: true });
          out.push({ c: cs, off: false });
          if (dB > 40) out.push({ c: [cs[cs.length - 1], [b.lon, b.lat]], off: true });
        }
      } catch (e) {
        console.warn('Enrutador:', e);
        if (++this.routerErrors >= 3) this.noRouter = true;
      }
    }
    this.legs.set(key, out);
    return out;
  },
  async buildDay(d, T, pace, M) {
    for (let tries = 0; ; tries++) {
      const nodes = [d.from, ...d.seq, d.to], legs = new Array(nodes.length - 1);
      let k = 0;
      await Promise.all(Array.from({ length: 3 }, async () => {
        while (k < legs.length) { const i = k++; legs[i] = await this.routeLeg(nodes[i], nodes[i + 1]); }
      }));
      const pieces = legs.flat();
      let t = 0, dist = 0, up = 0, down = 0, off = 0;
      for (const p of pieces) {
        const s = planProfile(p.c);
        t += planMide(s.d, s.up, s.down, p.off, pace) * (p.off ? 1 + Math.min(2, s.steep / 150) : 1);
        dist += s.d; up += s.up; down += s.down;
        if (p.off) off += s.d;
      }
      Object.assign(d, { pieces, t, dist, up, down, off });
      if (t <= T * 1.15 || !d.seq.length || tries >= 3) return;
      // Por sendero sale más largo de lo estimado: se quita la cumbre que más tiempo ahorra
      const r = [d.from, ...d.seq, d.to];
      let bi = 0, bs = -Infinity;
      for (let i = 1; i < r.length - 1; i++) {
        const save = M(r[i - 1], r[i]) + M(r[i], r[i + 1]) - M(r[i - 1], r[i + 1]);
        if (save > bs) { bs = save; bi = i - 1; }
      }
      d.seq.splice(bi, 1);
    }
  },
  /** Agua a menos de 100-300 m del trazado: fuentes, lagunas, refugios guardados y arroyos con nombre. */
  addWater(days, pois) {
    const items = pois ? pois.items.filter((it) => it.k === 'fuente' || it.k === 'laguna' || it.k === 'refugio') : [];
    const streams = pois ? pois.streams : [];
    for (const d of days) {
      const pts = [], cum = [];
      let acc = 0, prev = null;
      for (const p of d.pieces) for (const c of planDensify(p.c, 80)) {
        if (prev) acc += fastDist(prev[1], prev[0], c[1], c[0]);
        pts.push(c); cum.push(acc); prev = c;
      }
      const bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const c of pts) { bb[0] = Math.min(bb[0], c[0]); bb[1] = Math.min(bb[1], c[1]); bb[2] = Math.max(bb[2], c[0]); bb[3] = Math.max(bb[3], c[1]); }
      const inBB = (lon, lat) => lon > bb[0] - 0.01 && lon < bb[2] + 0.01 && lat > bb[1] - 0.01 && lat < bb[3] + 0.01;
      const along = (lat, lon, r) => { let best = Infinity, at = 0; for (let i = 0; i < pts.length; i++) { const x = fastDist(lat, lon, pts[i][1], pts[i][0]); if (x < best) { best = x; at = i; } } return best <= r ? cum[at] : null; };
      const found = [];
      for (const it of items) {
        if (!inBB(it.lon, it.lat)) continue;
        const km = along(it.lat, it.lon, it.k === 'laguna' ? (it.r || 120) + 120 : it.k === 'refugio' ? 150 : 250);
        if (km != null) found.push({ k: it.k, n: it.n || POI_INFO[it.k].label, km, np: it.np, lat: it.lat, lon: it.lon });
      }
      for (const s of streams) {
        for (const c of s.c) {
          if (!inBB(c[0], c[1])) continue;
          const km = along(c[1], c[0], 100);
          if (km != null) {
            if (!found.some((f) => f.k === 'arroyo' && f.n === s.n && Math.abs(f.km - km) < 1500)) found.push({ k: 'arroyo', n: s.n, km, lat: c[1], lon: c[0] });
            break;
          }
        }
      }
      found.sort((a, b) => a.km - b.km);
      let last = 0, gap = 0;
      for (const f of found) { gap = Math.max(gap, f.km - last); last = f.km; }
      d.water = found;
      d.dry = Math.max(gap, acc - last);
    }
  },

  resultHtml() {
    const { days, left, noRouter, mode, start, tried } = this.st.res;
    const tot = days.reduce((a, d) => ({ p: a.p + d.seq.length, km: a.km + d.dist, up: a.up + d.up, t: a.t + d.t }), { p: 0, km: 0, up: 0, t: 0 });
    let n = 0;
    const html = days.map((d, i) => {
      const col = PLAN_COLORS[i % PLAN_COLORS.length], last = i === days.length - 1;
      const steps = d.seq.map((p) => `<li><span class="pn" style="background:${col}">${++n}</span>${p.tag ? `${esc(p.tag)}: ` : ''}${esc(p.n)}${p.e != null ? ` <span class="cota">${fmt.num(p.e)}</span>` : ''}</li>`).join('');
      const end = last ? `Vuelta a ${esc(start.n)}` : `${mode === 'vivac' ? 'Vivac' : 'Noche'}: ${esc(d.to.n)}${d.to.water ? ' (agua al lado)' : ''}`;
      const water = d.water.length
        ? d.water.map((w) => `${esc(w.n)}${w.k === 'arroyo' ? ' (arroyo)' : w.k === 'fuente' && w.np ? ' (no potable)' : ''} en el km ${fmtKm1(w.km)}`).join(' · ')
        : 'no he encontrado agua cerca del trazado';
      return `<section class="plan-day"><h3><i style="background:${col}"></i>Día ${i + 1}: ${fmtHours(d.t)}, ${fmt.km(d.dist)}, +${fmt.num(Math.round(d.up))} m</h3>
        <ol class="plan-steps"><li class="st">Salida: ${esc(d.from.n)}</li>${steps}<li class="st">${end}</li></ol>
        <p class="small"><b>Agua:</b> ${water}.${d.dry > 8000 ? ` <span class="plan-dry">Hasta ${fmt.km(d.dry)} seguidos sin agua conocida.</span>` : ''}</p>
        ${d.off > 200 ? `<p class="small muted">${fmt.km(d.off)} sin sendero (línea discontinua).</p>` : ''}</section>`;
    }).join('');
    const notes = [
      'Tiempos por el método MIDE, sin paradas. Los tramos sin sendero son estimaciones en línea recta sobre el relieve: comprueba en el mapa que se pueden pasar.',
      noRouter ? 'No he podido usar el enrutador de senderos, así que todo el trazado va en línea recta.' : '',
      start.k === 'road' ? 'Deja el coche solo donde esté permitido aparcar y sin estorbar el paso.' : '',
      mode === 'vivac' ? 'Antes de hacer vivac, consulta la normativa del espacio protegido: suele estar limitado a ciertas zonas, alturas y horas.' : '',
      mode === 'refugios' ? 'Los refugios guardados suelen pedir reserva, y los libres pueden estar llenos o cerrados.' : '',
      'Las fuentes y arroyos pueden secarse en verano: lleva filtro o pastillas.',
      left > 0 ? `Te ${left === 1 ? 'queda 1 cumbre pendiente' : `quedan ${left} cumbres pendientes`} de este reto en la zona que no caben en este plan.` : '',
    ].filter(Boolean);
    return `<div class="plan-res">
      ${tried > 1 ? `<p class="small" style="margin:0">He probado ${tried} sitios para dejar el coche; el que permite más cumbres es <b>${esc(start.n)}</b>.</p>` : ''}
      <p class="plan-sum"><b>${tot.p}</b> ${tot.p === 1 ? 'cumbre pendiente' : 'cumbres pendientes'} en ${days.length === 1 ? 'un día' : `${days.length} días`}: ${fmt.km(tot.km)} y +${fmt.num(Math.round(tot.up))} m, unas ${fmtHours(tot.t)} de marcha.</p>
      ${html}
      <ul class="plan-notes">${notes.map((t) => `<li>${t}</li>`).join('')}</ul>
      <div class="row"><button class="btn small" type="button" data-act="plan-gpx">Exportar GPX</button>${Offline.available() ? '<button class="btn small" type="button" data-act="plan-offline">Guardar la zona sin conexión</button>' : ''}<button class="btn small quiet" type="button" data-act="plan-fit">Ver en el mapa</button></div>
    </div>`;
  },
  geo() {
    const r = this.st.res, lines = [], pts = [];
    const F = (p, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { n: p.n || '', ...props } });
    let n = 0;
    r.days.forEach((d, i) => {
      const col = PLAN_COLORS[i % PLAN_COLORS.length];
      for (const p of d.pieces) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.c }, properties: { col, off: !!p.off } });
      for (const w of d.water) pts.push(F(w, { t: 'water', col: '#1d86c9', lbl: '' }));
      for (const p of d.seq) pts.push(F(p, { t: 'peak', col, lbl: String(++n) }));
      if (i < r.days.length - 1) pts.push(F(d.to, { t: 'night', col, lbl: `${r.mode === 'vivac' ? 'Vivac' : 'Noche'} ${i + 1}` }));
    });
    pts.push(F(r.start, { t: 'start', col: '#1e2622', lbl: 'Salida' }));
    return { lines, pts };
  },
  bbox() {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const d of this.st.res.days) for (const p of d.pieces) for (const c of p.c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }
    return b;
  },
  show(fit) {
    if (!this.st || !this.st.res || !MapCtl.view || !MapCtl.view.setPlan) return;
    MapCtl.view.setPlan(this.geo());
    if (fit) MapCtl.view.fit(this.bbox());
  },
  clear() { if (MapCtl.view && MapCtl.view.setPlan) MapCtl.view.setPlan(null); },
  gpx() {
    const st = this.st, r = st && st.res;
    if (!r) return;
    let n = 0;
    const w = [[`Salida: ${r.start.n}`, r.start]];
    r.days.forEach((d, i) => {
      d.seq.forEach((p) => w.push([`${++n}. ${p.n}`, p]));
      if (i < r.days.length - 1) w.push([`${r.mode === 'vivac' ? 'Vivac' : 'Noche'} ${i + 1}: ${d.to.n}`, d.to]);
      d.water.forEach((x) => w.push([`Agua: ${x.n}`, x]));
    });
    const trk = r.days.map((d, i) => `<trk><name>Día ${i + 1}</name><trkseg>${d.pieces.flatMap((p) => p.c).map((c) => {
      const e = PlanDem.ele(c[0], c[1]);
      return `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${e != null ? `<ele>${e.toFixed(1)}</ele>` : ''}</trkpt>`;
    }).join('')}</trkseg></trk>`).join('');
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Cuaderno de cumbres" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc('Plan: ' + st.reto.name)}</name></metadata>${w.map(([nm, p]) => `<wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${esc(nm)}</name></wpt>`).join('')}${trk}</gpx>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
    a.download = `plan-${st.reto.id}-${new Date().toISOString().slice(0, 10)}.gpx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  },
  offline() {
    if (!this.st || !this.st.res) return;
    const b = this.bbox();
    UI.saveZone([b[0] - 0.02, b[1] - 0.015, b[2] + 0.02, b[3] + 0.015], `Plan: ${this.st.reto.name}`);
  },
};
