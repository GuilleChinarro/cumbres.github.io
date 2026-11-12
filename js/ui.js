'use strict';
/* ===================== 8. Interfaz del cuaderno ===================== */
Actions.removePeak = function (routeId, peakId) {
  const r = S.routes.get(routeId);
  if (!r) return;
  const pe = r.peaks.find((p) => p.id === peakId);
  if (pe && pe.m) { r.peaks = r.peaks.filter((p) => p.id !== peakId); delete r.decisions[peakId]; }
  else r.decisions[peakId] = 'none';
  invalidate(); saveRoute(r);
};

const VTX = (kind = 'climbed', size = 14) =>
  `<svg class="vtx${kind === 'near' ? ' near' : kind === 'osm' ? ' osm' : ''}" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path class="t" d="M8 1.6 15 14.2H1z"/><circle class="d" cx="8" cy="10" r="1.7"/></svg>`;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
function routeScale(r) { const t = r._P.cum[r._P.n - 1] || 1; return (r.stats?.dist || t) / t; }
function idxAt(P, at) {
  let lo = 0, hi = P.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.cum[mid] <= at) lo = mid; else hi = mid; }
  return at - P.cum[lo] <= P.cum[hi] - at ? lo : hi;
}
function eleAt(P, at) {
  if (!P.ele) return null;
  let lo = 0, hi = P.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (P.cum[mid] <= at) lo = mid; else hi = mid; }
  const span = P.cum[hi] - P.cum[lo];
  const f = span > 0 ? clamp((at - P.cum[lo]) / span, 0, 1) : 0;
  return P.ele[lo] + f * (P.ele[hi] - P.ele[lo]);
}
function routeCenter(r) { const [w, s, e, n] = r.bbox; return { lat: (s + n) / 2, lon: (w + e) / 2 }; }
function peakName(pe) { const i = peakInfo(pe.id, pe); return (i && i.name) || pe.n || 'Cumbre'; }
function routeQuote(name) { return `«${name}»`; }

function statsInline(r) {
  const st = r.stats || {};
  return `<div class="r-stats"><span><b>${fmt.kmNum(st.dist)}</b> km</span>` +
    (st.gain != null ? `<span>+<b>${fmt.num(st.gain)}</b> m</span>` : '') +
    (st.maxEle != null ? `<span class="cota">${fmt.num(st.maxEle)} m</span>` : '') +
    (st.duration ? `<span>${fmt.dur(st.duration)}</span>` : '') + `</div>`;
}
function sparkSvg(r) {
  const P = r._P;
  if (!P.ele || P.n < 2) return '';
  const N = 56, w = 112, h = 30, total = P.cum[P.n - 1] || 1;
  const ys = [];
  let mn = Infinity, mx = -Infinity, j = 0;
  for (let k = 0; k <= N; k++) {
    const target = (total * k) / N;
    while (j < P.n - 1 && P.cum[j + 1] <= target) j++;
    const e = P.ele[j];
    ys.push(e); if (e < mn) mn = e; if (e > mx) mx = e;
  }
  const rng = Math.max(mx - mn, 60);
  const pts = ys.map((e, k) => `${((k / N) * w).toFixed(1)},${(h - 2 - ((e - mn) / rng) * (h - 5)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="M0,${h} L${pts.join(' L')} L${w},${h} Z"/><path d="M${pts.join(' L')}"/></svg>`;
}
function peaksInline(r, max = 6) {
  const climbed = [], near = [];
  for (const pe of r.peaks) { const s = statusOf(r, pe); if (s === 'climbed') climbed.push(pe); else if (s === 'near') near.push(pe); }
  if (!climbed.length && !near.length) return '';
  let html = climbed.slice(0, max).map((pe) => `<span class="pk">${VTX('climbed', 12)}${esc(peakName(pe))}</span>`).join('');
  if (climbed.length > max) html += `<span class="pk muted">y ${climbed.length - max} más</span>`;
  if (near.length) {
    const nm = near.slice(0, 2).map((pe) => esc(peakName(pe))).join(', ');
    html += `<span class="pk near">${VTX('near', 12)}${nm}${near.length > 2 ? ` y ${near.length - 2} más` : ''}</span>`;
  }
  return `<div class="r-peaks">${html}</div>`;
}

/* ---------- Vistas ---------- */
function emptyState() {
  return `<div class="empty">
    <h2>Tu cuaderno está vacío</h2>
    <p>Arrastra aquí tus archivos GPX, uno o varios a la vez. Cada ruta se cruza con las cumbres de OpenStreetMap y verás cuáles subiste y por cuáles pasaste cerca.</p>
    <div class="dropzone">
      <div class="row"><button class="btn primary" data-act="add-files" type="button">Añadir GPX o FIT</button><button class="btn" data-act="load-demo" type="button">Ver rutas de ejemplo</button></div>
      <span class="small muted">O suelta los archivos en cualquier parte de la ventana. Si ya tienes una exportación del cuaderno, impórtala desde Datos.</span>
    </div>
  </div>`;
}
function demoCount() { let n = 0; for (const r of S.routes.values()) if (r.source && r.source.kind === 'demo') n++; return n; }
function demoNote() {
  const n = demoCount();
  return n ? `<div class="demo-note"><span>${n === 1 ? 'Hay 1 ruta de ejemplo inventada' : `Hay ${n} rutas de ejemplo inventadas`} para que pruebes el cuaderno.</span> <button class="link" type="button" data-act="delete-demo">Borrar ejemplos</button></div>` : '';
}
function filterOptions() {
  const rs = routesSorted();
  const years = [...new Set(rs.map((r) => fmt.year(r.date) || 'sin'))].sort((a, b) => (a === 'sin' ? 1 : b === 'sin' ? -1 : b.localeCompare(a)));
  const types = [...new Set(rs.map((r) => r.type))].sort((a, b) => (TYPE_LABEL[a] || a).localeCompare(TYPE_LABEL[b] || b, 'es'));
  const sierras = [...new Set(rs.flatMap((r) => routeSierras(r)))].sort((a, b) => a.localeCompare(b, 'es'));
  const peaks = [...mountains().values()].filter((m) => m.climbs.length || (S.ui.includeNear && m.nears.length))
    .sort((a, b) => a.info.name.localeCompare(b.info.name, 'es'));
  return { years, types, sierras, peaks };
}
function selectField(label, key, options, value, allLabel) {
  const has = options.some(([v]) => v === value);
  const opts = (value && !has ? [[value, value]] : []).concat(options);
  return `<label class="field"><span>${label}</span><select data-f="${key}"><option value="">${allLabel}</option>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
function routesView() {
  if (!S.routes.size) return emptyState();
  const o = filterOptions(), f = S.ui.filters;
  return `<div class="filters">
    ${selectField('Año', 'year', o.years.map((y) => [y, y === 'sin' ? 'Sin fecha' : y]), f.year, 'Todos')}
    ${selectField('Tipo', 'type', o.types.map((t) => [t, TYPE_LABEL[t] || t]), f.type, 'Todos')}
    ${selectField('Sierra', 'sierra', o.sierras.map((s) => [s, s]), f.sierra, 'Todas')}
    ${selectField('Montaña', 'peak', o.peaks.map((m) => [m.id, m.info.name + (m.info.ele != null ? ` (${m.info.ele})` : '')]), f.peak, 'Todas')}
    <label class="field full"><span class="sr">Buscar ruta</span><input type="search" data-f="q" placeholder="Buscar por nombre" value="${esc(f.q)}" autocomplete="off"></label>
    <div class="summary" id="rsum"></div>
    ${demoNote()}
  </div>
  <ul class="list" id="rlist"></ul>`;
}
function routeRow(r) {
  const off = isHidden(r.id);
  const sel = S.ui.selRoute === r.id;
  return `<li class="route${off ? ' off' : ''}${sel ? ' sel' : ''}" data-act="open-route" data-id="${esc(r.id)}" tabindex="0" style="--c:${r._color}">
    <button class="eye" type="button" data-act="toggle-route" data-id="${esc(r.id)}" aria-pressed="${!off}" aria-label="${off ? 'Mostrar' : 'Ocultar'} en el mapa: ${esc(r.name)}" title="${off ? 'Mostrar en el mapa' : 'Ocultar en el mapa'}"><span class="sw"></span></button>
    <div>
      <div class="r-top"><span class="r-name">${esc(r.name)}</span><span class="r-date">${fmt.date(r.date)}</span></div>
      <div class="r-mid">${statsInline(r)}${sparkSvg(r)}</div>
      <div class="r-mid" style="margin-top:3px"><span class="chips">${isPlan(r) ? '<span class="chip plan">Proyecto</span>' : ''}<span class="chip">${esc(TYPE_LABEL[r.type] || r.type)}</span>${gradeLine(r) ? `<span class="grade">${esc(gradeLine(r))}</span>` : ''}${alpOf(r).outcome === 'retirada' ? '<span class="chip retreat">Retirada</span>' : ''}</span></div>
      ${alpOf(r).via || (alpOf(r).team || []).length ? `<div class="small muted r-via">${esc([alpOf(r).via, (alpOf(r).team || []).length ? 'con ' + listJoin(alpOf(r).team) : ''].filter(Boolean).join(' · '))}</div>` : ''}
      ${peaksInline(r)}
    </div>
  </li>`;
}
function mountainsView() {
  if (!S.routes.size) return emptyState();
  const sorts = [['ele', 'Por altitud'], ['count', 'Por veces'], ['last', 'Por fecha'], ['name', 'Por nombre'], ['sierra', 'Por sierra']];
  return `<div class="mtools">
    <label class="field"><span class="sr">Buscar montaña</span><input type="search" data-m="q" placeholder="Buscar montaña o sierra" value="${esc(S.ui.mq)}" autocomplete="off"></label>
    <label class="field"><span class="sr">Ordenar</span><select data-m="sort">${sorts.map(([v, l]) => `<option value="${v}"${S.ui.sortPeaks === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="toggle"><input type="checkbox" data-m="near"${S.ui.includeNear ? ' checked' : ''}> Incluir las que pasé cerca</label>
    <div class="summary" id="msum"></div>
  </div>
  <ul class="list" id="mlist"></ul>`;
}
const MSORT = {
  ele: (a, b) => (b.info.ele ?? -1) - (a.info.ele ?? -1) || a.info.name.localeCompare(b.info.name, 'es'),
  count: (a, b) => b.climbs.length - a.climbs.length || b.nears.length - a.nears.length || (b.info.ele ?? -1) - (a.info.ele ?? -1),
  last: (a, b) => (b.last || '').localeCompare(a.last || '') || (b.info.ele ?? -1) - (a.info.ele ?? -1),
  name: (a, b) => a.info.name.localeCompare(b.info.name, 'es'),
  sierra: (a, b) => (a.info.sierra || '\uffff').localeCompare(b.info.sierra || '\uffff', 'es') || (b.info.ele ?? -1) - (a.info.ele ?? -1),
};
function datesText(list) {
  const d = list.map((r) => fmt.date(r.date));
  return d.length <= 3 ? listJoin(d) : `${d.slice(0, 2).join(', ')} y ${d.length - 2} más`;
}
function routesText(list) {
  const n = [...new Set(list.map((r) => r.name))].map(routeQuote);
  return n.length <= 2 ? listJoin(n) : `${n.slice(0, 2).join(', ')} y ${n.length - 2} más`;
}
function mountainRow(m) {
  const climbed = m.climbs.length > 0;
  const list = climbed ? m.climbs : m.nears;
  const extra = climbed && S.ui.includeNear && m.nears.length ? `<span class="m-count near">y cerca ${fmt.times(m.nears.length)}</span>` : '';
  return `<li class="mountain" data-act="open-peak" data-id="${esc(m.id)}" tabindex="0">
    ${VTX(climbed ? 'climbed' : 'near', 16)}
    <div>
      <div class="m-name">${esc(m.info.name)}</div>
      ${m.info.sierra ? `<div class="m-sierra">${esc(m.info.sierra)}</div>` : ''}
      <div class="m-when">${climbed ? 'Subida' : 'Pasé cerca'}: ${esc(datesText(list))}</div>
      <div class="m-when">Con ${esc(routesText(list))}</div>
    </div>
    <div class="m-right"><span class="m-ele cota">${m.info.ele != null ? fmt.num(m.info.ele) : '—'}</span>
      <span class="m-count${climbed ? '' : ' near'}">${climbed ? fmt.times(m.climbs.length) : 'cerca ' + fmt.times(m.nears.length)}</span>${extra}</div>
  </li>`;
}

/* Ficha de ruta */
function peakRow(r, { pe, st, dec }) {
  const info = peakInfo(pe.id, pe) || {};
  const where = pe.d < 1 ? 'Sobre el track' : `A ${pe.d >= 1000 ? fmt.km(pe.d) : fmt.m(pe.d)} del track`;
  const km = `km ${fmt.kmNum(pe.at * routeScale(r))}`;
  const how = pe.m ? 'Añadida por ti.' : dec ? `Confirmado por ti. <button class="link" type="button" data-act="undecide" data-id="${esc(pe.id)}">Volver a automático</button>` : 'Automático.';
  const nm = esc(info.name || pe.n);
  return `<li class="peakrow">
    ${VTX(st, 16)}
    <div class="nm"><button class="link plain" type="button" data-act="open-peak" data-id="${esc(pe.id)}">${nm}</button> ${info.ele != null ? `<span class="cota">${fmt.num(info.ele)}</span>` : ''}</div>
    <div class="ctl"><div class="seg" role="group" aria-label="Estado de ${nm}">
      <button class="climb" type="button" data-act="decide" data-v="climbed" data-id="${esc(pe.id)}" aria-pressed="${st === 'climbed'}">Subí</button>
      <button class="near" type="button" data-act="decide" data-v="near" data-id="${esc(pe.id)}" aria-pressed="${st === 'near'}">Cerca</button>
      <button type="button" data-act="remove-peak" data-id="${esc(pe.id)}" aria-label="Quitar ${nm} de esta ruta">Quitar</button>
    </div></div>
    <div class="sub">${where}, en el ${km}. ${how}</div>
  </li>`;
}
function addPeakPanel(r) {
  if (!S.ui.addPeakOpen) return '';
  const np = S.ui.newPeak;
  if (np) {
    return `<div class="addpeak">
      <b>Nueva cumbre</b>
      <p class="small muted" style="margin:0">En ${np.lat.toFixed(5)}, ${np.lon.toFixed(5)}${isFinite(np.d) ? `, a ${fmt.m(np.d)} del track` : ''}. Se buscará también en el resto de tus rutas.</p>
      <div class="grid2"><label class="field"><span>Nombre</span><input type="text" id="npName" maxlength="120" value="${esc(np.name || '')}"></label>
      <label class="field"><span>Altitud (m)</span><input type="number" id="npEle" step="1" value="${np.ele ?? ''}"></label></div>
      <div class="row"><button class="btn primary small" type="button" data-act="save-new-peak">Guardar cumbre</button><button class="btn quiet small" type="button" data-act="cancel-place">Cancelar</button></div>
    </div>`;
  }
  return `<div class="addpeak">
    <label class="field"><span>Busca la cumbre por su nombre</span><input type="search" id="addq" placeholder="Por ejemplo, Peñalara" value="${esc(S.ui.addPeakQ)}" autocomplete="off"></label>
    <ul class="results" id="addres">${addResults(r)}</ul>
    <div class="row small"><span class="muted">¿No aparece?</span><button class="link" type="button" data-act="place-peak">Márcala en el mapa</button></div>
  </div>`;
}
function addResults(r) {
  const q = S.ui.addPeakQ.trim();
  if (q.length < 2) return '';
  const c = routeCenter(r);
  const nq = norm(q);
  const items = [];
  for (const [id, cp] of Object.entries(S.data.customPeaks)) {
    if (norm(cp.name).includes(nq)) items.push({ p: { id, ...cp }, key: `data-act="pick-custom" data-id="${esc(id)}"` });
  }
  for (const { i } of Ref.search(q, c.lat, c.lon, 20)) items.push({ p: Ref.peak(i), key: `data-act="pick-peak" data-i="${i}"` });
  if (!items.length) return '<li class="small muted" style="padding:6px">Sin resultados en OpenStreetMap. Puedes marcarla en el mapa.</li>';
  return items.slice(0, 20).map(({ p, key }) => {
    const d = nearestOnTrack(r._P, p.lat, p.lon).d;
    return `<li><button type="button" ${key}><span><b>${esc(p.name)}</b> ${p.ele != null ? `<span class="cota">${fmt.num(p.ele)}</span>` : ''}${p.sierra ? `<br><span class="small muted">${esc(renameSierra(p.sierra))}</span>` : ''}</span><span class="small muted">a ${d < 1000 ? fmt.m(d) : fmt.km(d)} del track</span></button></li>`;
  }).join('');
}
function routeDetail(id) {
  const r = S.routes.get(id);
  if (!r) return `<div class="empty"><p>Esta ruta ya no está en el cuaderno.</p><button class="btn" type="button" data-act="back">Volver</button></div>`;
  const st = r.stats || {};
  const entries = r.peaks.map((pe) => ({ pe, st: statusOf(r, pe), dec: r.decisions[pe.id] }));
  const shown = entries.filter((x) => x.st !== 'none');
  const disc = entries.filter((x) => x.st === 'none' && x.dec === 'none');
  const nC = shown.filter((x) => x.st === 'climbed').length, nN = shown.length - nC;
  const dateVal = r.date ? (() => { const d = new Date(r.date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })() : '';
  const src = r.source || {};
  return `<div class="detail">
    <div class="d-head">
      <button class="btn quiet small back" type="button" data-act="back">‹ ${S.ui.prev === 'mountains' ? 'Montañas' : S.ui.prev === 'stats' ? 'Resumen' : S.ui.prev === 'reto' ? 'Reto' : S.ui.prev === 'retos' ? 'Retos' : 'Rutas'}</button>
      <input class="d-title" data-edit="name" value="${esc(r.name)}" aria-label="Nombre de la ruta" maxlength="200">
      <div class="d-meta">
        <label class="field"><span>Fecha</span><input type="date" data-edit="date" value="${dateVal}"></label>
        <label class="field"><span>Tipo de actividad</span><select data-edit="type">${TYPES.map(([v, l]) => `<option value="${v}"${v === r.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
    </div>
    <div class="stats">
      <div class="stat"><span class="k">Distancia</span><span class="v">${fmt.km(st.dist)}</span></div>
      <div class="stat"><span class="k">Desnivel positivo</span><span class="v">${fmt.m(st.gain)}</span></div>
      <div class="stat"><span class="k">Desnivel negativo</span><span class="v">${fmt.m(st.loss)}</span></div>
      <div class="stat"><span class="k">Altitud máxima</span><span class="v cota">${fmt.m(st.maxEle)}</span></div>
      <div class="stat"><span class="k">Duración</span><span class="v">${fmt.dur(st.duration)}</span></div>
      <div class="stat"><span class="k">En movimiento</span><span class="v">${fmt.dur(st.moving)}</span></div>
    </div>
    <div class="sec"><h3>Perfil</h3><div class="profile" id="prof"></div></div>
    <div class="sec">
      <h3>Cumbres <span class="muted">${nC === 1 ? '1 subida' : `${nC} subidas`}${nN ? `, ${nN} cerca` : ''}</span></h3>
      ${shown.length ? `<ul class="peaklist">${shown.map((x) => peakRow(r, x)).join('')}</ul>` : `<p class="small muted" style="margin:0 0 8px">No hay ninguna cumbre de OpenStreetMap a menos de ${S.data.settings.nearM} m del track.</p>`}
      ${disc.length ? `<p class="discarded"><button class="link" type="button" data-act="toggle-discarded">${S.ui.showDiscarded ? 'Ocultar' : 'Ver'} descartadas (${disc.length})</button></p>${S.ui.showDiscarded ? `<ul class="peaklist">${disc.map((x) => `<li class="peakrow">${VTX('near', 16)}<div class="nm muted">${esc(peakName(x.pe))}</div><div class="ctl"><button class="btn small" type="button" data-act="undecide" data-id="${esc(x.pe.id)}">Restaurar</button></div><div class="sub">A ${fmt.m(x.pe.d)} del track.</div></li>`).join('')}</ul>` : ''}` : ''}
      <div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="add-peak" aria-expanded="${S.ui.addPeakOpen}">${S.ui.addPeakOpen ? 'Cerrar' : 'Añadir cumbre'}</button></div>
      ${addPeakPanel(r)}
    </div>
    ${alpSections(r)}
    <div id="schedBox">${scheduleSection(r)}</div>
    ${terrainSection(r)}
    ${wxSection(r)}
    <div class="sec row">
      <button class="btn small" type="button" data-act="fit-route">Ver en el mapa</button>
      ${MapCtl.kind === 'maplibre' ? '<button class="btn small" type="button" data-act="fly-route">Volar la ruta en 3D</button>' : ''}
      ${Offline.available() ? '<button class="btn small" type="button" data-act="offline-route">Guardar para ir sin cobertura</button>' : ''}
      <button class="btn small" type="button" data-act="export-gpx">Exportar GPX</button>
      <button class="btn small danger" type="button" data-act="delete-route">Borrar ruta</button>
    </div>
    <p class="sec small muted" style="margin:0">${src.kind === 'demo' ? 'Ruta de ejemplo inventada' : src.kind === 'gpx' || !src.kind ? 'Archivo GPX' : src.kind === 'fit' ? 'Archivo FIT' : esc(src.kind)}${src.file && src.kind !== 'demo' ? ` ${esc(src.file)}` : ''}${r.created ? `, añadida el ${fmt.dateLong(r.created)}` : ''}.${routeSierras(r).length ? ` Sierra: ${esc(listJoin(routeSierras(r).slice(0, 3)))}.` : ''}</p>
  </div>`;
}
function drawProfile(el, r) {
  if (!el || !r) return;
  const P = r._P;
  if (!P.ele) { el.innerHTML = '<p class="small muted" style="margin:0">Este track no trae datos de altitud.</p>'; return; }
  const W = Math.max(240, Math.round(el.clientWidth || 380)), H = 170, L = 40, R = 10, T = 14, B = 22;
  el._w = W;
  const total = P.cum[P.n - 1] || 1, scale = routeScale(r);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < P.n; i++) { const e = P.ele[i]; if (e < mn) mn = e; if (e > mx) mx = e; }
  const ys = niceStep(Math.max(mx - mn, 60) / 3);
  const y0 = Math.floor(mn / ys) * ys, y1 = Math.max(Math.ceil(mx / ys) * ys, y0 + ys);
  const X = (d) => L + (d / total) * (W - L - R);
  const Y = (e) => T + (1 - (e - y0) / (y1 - y0)) * (H - T - B);
  const step = Math.max(1, Math.floor(P.n / (W * 1.5)));
  let d = '';
  for (let i = 0; i < P.n; i += step) d += (d ? 'L' : 'M') + X(P.cum[i]).toFixed(1) + ',' + Y(P.ele[i]).toFixed(1);
  d += 'L' + X(total).toFixed(1) + ',' + Y(P.ele[P.n - 1]).toFixed(1);
  let grid = '';
  for (let v = y0; v <= y1 + 1e-6; v += ys) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${fmt.num(v)}</text>`;
  const kmTot = (total * scale) / 1000;
  const xs = niceStep(kmTot / 4);
  for (let k = 0; k <= kmTot + 1e-9; k += xs) {
    const x = X((k * 1000) / scale);
    grid += `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : 'middle'}">${k === 0 ? '0' : (xs < 1 ? NF1.format(k) : fmt.num(k))} km</text>`;
  }
  let marks = '';
  for (const pe of r.peaks) {
    const st = statusOf(r, pe);
    if (st === 'none') continue;
    const x = X(pe.at), y = Y(eleAt(P, pe.at)) - 9;
    marks += `<g transform="translate(${(x - 7).toFixed(1)},${(y - 7).toFixed(1)})"><title>${esc(peakName(pe))}</title>${VTX(st, 14).replace('<svg ', '<svg x="0" y="0" ')}</g>`;
  }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Perfil de altitud de la ruta">
    <g class="grid">${grid}</g>
    <path class="area" d="${d}L${X(total).toFixed(1)},${H - B}L${L},${H - B}Z"/>
    <path class="line" d="${d}"/>
    ${((r.alp && r.alp.terrain && r.alp.terrain.segs) || []).map(([a, b]) => `<rect class="steep" x="${X(a).toFixed(1)}" y="${H - B - 3}" width="${Math.max(1.5, X(Math.min(b, total)) - X(a)).toFixed(1)}" height="3"><title>Ladera de más de 30°</title></rect>`).join('')}
    ${marks}${((r.alp && r.alp.wps) || []).map((w) => `<g class="wpm ${w.kind}" transform="translate(${X(w.at).toFixed(1)},${(Y(eleAt(P, w.at)) - 7).toFixed(1)})"><title>${esc(w.name || WP_LABEL[w.kind])}</title><path d="M0-6 5 0 0 6-5 0z"/></g>`).join('')}
    <line class="cursor" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), cur = svg.querySelector('.cursor'), tip = el.querySelector('.tip');
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const x = clamp(ev.clientX - rect.left, L, W - R);
    const at = ((x - L) / (W - L - R)) * total;
    const i = idxAt(P, at);
    const cx = X(P.cum[i]);
    cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = clamp(cx, 50, W - 50) + 'px';
    tip.textContent = `${fmt.m(P.ele[i])}, km ${fmt.kmNum(P.cum[i] * scale)}`;
    MapCtl.setCursor(P.lat[i], P.lon[i]);
    S.ui.profAt = P.cum[i];
    const wb = document.getElementById('wpBtn');
    if (wb) { wb.disabled = false; wb.textContent = `Marcar en km ${fmt.kmNum(P.cum[i] * scale)}`; }
  };
  const leave = () => { cur.setAttribute('visibility', 'hidden'); tip.hidden = true; MapCtl.setCursor(null); };
  el._showAt = (at) => {
    const i = idxAt(P, at), cx = X(P.cum[i]);
    cur.setAttribute('x1', cx); cur.setAttribute('x2', cx); cur.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.style.left = clamp(cx, 50, W - 50) + 'px';
    tip.textContent = `${fmt.m(P.ele[i])}, km ${fmt.kmNum(P.cum[i] * scale)}`;
  };
  el._routeId = r.id;
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

/* Ficha de montaña */
function miniRoutes(list, peakId, nearList = false) {
  return `<ul class="list mini">${list.map((r) => `<li class="route mini" data-act="open-route" data-id="${esc(r.id)}" tabindex="0" style="--c:${r._color}">
    <span class="eye" aria-hidden="true"><span class="sw"></span></span>
    <div><div class="r-top"><span class="r-name">${esc(r.name)}</span><span class="r-date">${fmt.date(r.date)}</span></div>
    <div class="r-mid">${statsInline(r)}${nearList ? `<button class="btn small" type="button" data-act="decide-in" data-route="${esc(r.id)}" data-id="${esc(peakId)}">La subí</button>` : ''}</div></div>
  </li>`).join('')}</ul>`;
}
function allSierraNames() {
  const set = new Set(Ref.sierras.map((s) => renameSierra(s.name)));
  for (const c of Object.values(S.data.customPeaks)) if (c.sierra) set.add(c.sierra);
  for (const e of Object.values(S.data.peakEdits)) if (e.sierra) set.add(e.sierra);
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}
function peakDetail(id) {
  const m = mountains().get(id);
  const info = (m && m.info) || peakInfo(id);
  if (!info) return `<div class="empty"><p>Esta cumbre ya no está en el cuaderno.</p><button class="btn" type="button" data-act="back">Volver</button></div>`;
  const climbs = m ? m.climbs : [], nears = m ? m.nears : [];
  const custom = id.startsWith('u:');
  const all = [...climbs, ...nears].filter((r) => r.date).sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="detail">
    <div class="d-head">
      <button class="btn quiet small back" type="button" data-act="back">‹ ${S.ui.prev === 'routes' ? 'Rutas' : 'Montañas'}</button>
      <div class="row" style="flex-wrap:nowrap;gap:6px">${VTX(climbs.length ? 'climbed' : 'near', 22)}<input class="d-title" data-pedit="name" value="${esc(info.name)}" aria-label="Nombre de la cumbre" maxlength="120"></div>
      <div class="d-meta">
        <label class="field"><span>Altitud (m)</span><input type="number" step="1" data-pedit="ele" value="${info.ele ?? ''}"></label>
        <label class="field"><span>Sierra o macizo</span><input type="text" list="dlSierras" data-pedit="sierra" value="${esc(info.sierra || '')}" placeholder="Sin asignar"></label>
      </div>
      <datalist id="dlSierras">${allSierraNames().map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
    </div>
    <div class="stats">
      <div class="stat"><span class="k">Subidas</span><span class="v">${climbs.length}</span></div>
      <div class="stat"><span class="k">Pasé cerca</span><span class="v">${nears.length}</span></div>
      <div class="stat"><span class="k">Primera vez</span><span class="v sm">${all.length ? fmt.date(all[0].date) : '—'}</span></div>
    </div>
    <div class="sec"><h3>Ascensiones <span class="muted">${climbs.length}</span></h3>${climbs.length ? miniRoutes(climbs, id) : '<p class="small muted" style="margin:0">Ninguna todavía.</p>'}</div>
    ${nears.length ? `<div class="sec"><h3>Pasé cerca <span class="muted">${nears.length}</span></h3>${miniRoutes(nears, id, true)}</div>` : ''}
    <div class="sec"><h3>Meteo en la cumbre</h3>${wxBox(info.lat, info.lon, info.ele)}${avalLinksHtml(info)}</div>
    <div class="sec row">
      <button class="btn small" type="button" data-act="peak-map" data-id="${esc(id)}">Ver en el mapa</button>
      ${climbs.length || nears.length ? `<button class="btn small" type="button" data-act="mfilter" data-id="${esc(id)}">Filtrar sus rutas</button>` : ''}
      ${custom ? `<button class="btn small danger" type="button" data-act="delete-peak" data-id="${esc(id)}">Borrar cumbre</button>` : info.edited ? `<button class="btn small" type="button" data-act="reset-peak" data-id="${esc(id)}">Restaurar datos de OSM</button>` : ''}
    </div>
    <p class="sec small muted" style="margin:0">${custom ? 'Cumbre añadida por ti; se busca automáticamente en todas tus rutas.' : `Fuente: OpenStreetMap, nodo ${esc(id.slice(4))}${info.edited ? ', con tus correcciones' : ''}.`} Coordenadas ${info.lat.toFixed(5)}, ${info.lon.toFixed(5)}.</p>
  </div>`;
}

/* Buscador: cumbres (tuyas y de OpenStreetMap), rutas, sierras y poblaciones */
function searchEverything(text) {
  const q = norm(text);
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (s) => { const n = norm(s); return words.every((w) => n.includes(w)); };
  const GENERIC = /^((pico|pic|picu|peña|pena|penya|cerro|alto|tuca|tossal|puig|monte|mont|montaña|muntanya|cabeza|cabezo|cueto|torre|risco|morro|sierra|serra|el|la|lo|los|las|del|de|d)\s+|d')+/;
  const rank = (s) => {
    const n = norm(s), core = n.replace(GENERIC, '');
    if (n === q || core === q) return 0;
    if (n.startsWith(q) || core.startsWith(q)) return 1;
    return n.split(/[\s'’/-]+/).some((t) => t.startsWith(words[0])) ? 2 : 3;
  };
  const out = [], seen = new Set();
  for (const m of mountains().values()) {
    if (!hit(m.info.name)) continue;
    seen.add(m.id);
    out.push({ kind: 'peak', id: m.id, name: m.info.name, ele: m.info.ele, mine: m.climbs.length ? 'climbed' : 'near',
      sub: [m.climbs.length ? `Subida ${fmt.times(m.climbs.length)}` : 'Pasé cerca', m.info.sierra].filter(Boolean).join(', '), r: rank(m.info.name) - 0.3 });
  }
  for (const r of S.routes.values()) if (hit(r.name)) out.push({ kind: 'route', id: r.id, name: r.name, color: r._color, sub: `Ruta del ${fmt.date(r.date)}`, r: rank(r.name) + 0.5 });
  for (const [id, c] of Object.entries(S.data.customPeaks)) {
    if (seen.has(id) || !hit(c.name)) continue;
    seen.add(id);
    out.push({ kind: 'peak', id, name: c.name, ele: c.ele, sub: c.sierra || 'Cumbre añadida por ti', r: rank(c.name) });
  }
  if (!Ref.nnames) Ref.nnames = Ref.name.map((s, i) => norm(s + (Ref.alt[i] ? ' ' + Ref.alt[i] : '')));
  let count = 0;
  for (let i = 0; i < Ref.n && count < 400; i++) {
    const nm = Ref.nnames[i];
    if (!words.every((w) => nm.includes(w))) continue;
    const id = 'osm:' + Ref.ids[i];
    if (seen.has(id)) continue;
    count++;
    const info = peakInfo(id);
    out.push({ kind: 'peak', id, name: info.name, ele: info.ele, sub: info.sierra || 'Cumbre de OpenStreetMap', r: rank(info.name) + (info.ele == null ? 0.5 : 0) });
  }
  const sier = new Set();
  for (const s of Ref.sierras) {
    const nm = renameSierra(s.name);
    if (sier.has(nm) || !hit(nm)) continue;
    sier.add(nm);
    out.push({ kind: 'sierra', id: nm, name: nm, sub: 'Sierra o macizo', r: rank(nm) + 0.3 });
  }
  for (const f of Ref.base.places.features) {
    const nm = f.properties.n;
    if (hit(nm)) out.push({ kind: 'place', id: nm, name: nm, sub: 'Población', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], r: rank(nm) + 0.6 });
  }
  out.sort((a, b) => a.r - b.r || (b.ele ?? -1) - (a.ele ?? -1) || a.name.localeCompare(b.name, 'es'));
  return out.slice(0, 12);
}
function searchItemHtml(it, k) {
  const ico = it.kind === 'peak' ? VTX(it.mine || 'osm', 15)
    : it.kind === 'route' ? `<span class="dot" style="--c:${it.color}"></span>`
      : it.kind === 'sierra' ? '<svg class="mq-sym" width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 13 6 4l3 5 3-7 5 11z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'
        : '<svg class="mq-sym" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="3.5" fill="currentColor"/></svg>';
  return `<li class="mq-item" role="option" id="mq-${k}" data-k="${k}" aria-selected="false"><span class="mq-ico">${ico}</span><span><b>${esc(it.name)}</b>${it.ele != null ? ` <span class="cota">${fmt.num(it.ele)}</span>` : ''}<small>${esc(it.sub || '')}</small></span></li>`;
}

/* Ventanas emergentes del mapa */
function routesPopup(ids) {
  const rs = ids.map((id) => S.routes.get(id)).filter(Boolean);
  if (!rs.length) return '';
  if (rs.length === 1) {
    const r = rs[0];
    return `<div class="pop"><h4>${esc(r.name)}</h4><div class="muted">${fmt.date(r.date)}, ${esc(TYPE_LABEL[r.type] || r.type)}</div>${statsInline(r)}${peaksInline(r, 4)}<div class="row"><button class="btn small primary" type="button" data-act="open-route" data-id="${esc(r.id)}">Ver ficha</button></div></div>`;
  }
  return `<div class="pop"><h4>${rs.length} rutas pasan por aquí</h4><ul>${rs.map((r) => `<li><button class="link plain" type="button" data-act="open-route" data-id="${esc(r.id)}"><span class="dot" style="--c:${r._color}"></span>${esc(r.name)}</button><div class="muted">${fmt.date(r.date)}</div></li>`).join('')}</ul></div>`;
}
function peakPopup(id) {
  const m = mountains().get(id);
  const info = (m && m.info) || peakInfo(id);
  if (!info) return '';
  const c = m ? m.climbs.length : 0, n = m ? m.nears.length : 0;
  const line = c ? `Subida ${fmt.times(c)}; la última, el ${fmt.dateLong(m.climbs[0].date)}.` : n ? `Pasé cerca ${fmt.times(n)}.` : 'No aparece en tus rutas.';
  return `<div class="pop"><h4>${esc(info.name)} ${info.ele != null ? `<span class="cota">${fmt.num(info.ele)}</span>` : ''}</h4>${info.sierra ? `<div class="muted">${esc(info.sierra)}</div>` : ''}<p style="margin:6px 0 8px">${esc(line)}</p><div class="row"><button class="btn small primary" type="button" data-act="open-peak" data-id="${esc(id)}">Ver ficha</button></div></div>`;
}
function osmPopup(props) {
  const id = props.id;
  if (mountains().has(id)) return peakPopup(id);
  const info = peakInfo(id) || { name: props.n, ele: props.e ?? null, sierra: '' };
  return `<div class="pop"><h4>${esc(info.name)} ${info.ele != null ? `<span class="cota">${fmt.num(info.ele)}</span>` : ''}</h4>${info.sierra ? `<div class="muted">${esc(info.sierra)}</div>` : ''}<p class="muted" style="margin:6px 0 0">Cumbre de OpenStreetMap. No pasa ninguna de tus rutas por ella.</p></div>`;
}

/* ---------- Controlador ---------- */
const UI = {
  body: null, scroll: {}, progEl: null, ro: null,

  init() {
    this.body = $('#panelBody');
    $$('.tab').forEach((b) => b.addEventListener('click', () => this.go(b.dataset.view)));
    $('#btnAdd').addEventListener('click', () => $('#inGpx').click());
    $('#inGpx').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) this.addFiles(f); });
    $('#inJson').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.importFile(f); });
    $('#btnData').addEventListener('click', () => this.openData());
    $('#btnSettings').addEventListener('click', () => this.openSettings());
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
    $$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
    $('#btnExport').addEventListener('click', () => this.doExport());
    $('#btnImport').addEventListener('click', () => $('#inJson').click());
    $('#btnWipe').addEventListener('click', () => this.wipe());
    $('#btnApplyThr').addEventListener('click', () => this.applyThresholds());
    $('#btnRedetect').addEventListener('click', () => this.redetect());
    $('#btnDemoLoad').addEventListener('click', () => this.loadDemo());
    $('#btnDemoDel').addEventListener('click', () => this.deleteDemo());
    $('#sierraEdit').addEventListener('change', (e) => {
      const inp = e.target.closest('input[data-orig]');
      if (!inp) return;
      Actions.renameSierra(inp.dataset.orig, inp.value);
      this.render(); MapCtl.syncVisible();
    });
    this.body.addEventListener('click', (e) => this.onClick(e));
    $('#mapwrap').addEventListener('click', (e) => { if (e.target.closest('[data-act]')) this.onClick(e); });
    this.body.addEventListener('change', (e) => this.onChange(e));
    this.body.addEventListener('toggle', (e) => { const k = e.target.dataset && e.target.dataset.fold; if (k) (S.ui.alpOpen = S.ui.alpOpen || {})[k] = e.target.open; }, true);
    this.body.addEventListener('input', (e) => this.onInput(e));
    this.body.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li[data-act]')) { e.preventDefault(); this.onClick(e); }
      if (e.key === 'Enter' && e.target.id === 'npName') this.saveNewPeak();
    });
    $$('#switcher button').forEach((b) => b.addEventListener('click', () => this.pane(b.dataset.pane)));
    $('#basemaps').addEventListener('click', (e) => { const b = e.target.closest('button[data-bm]'); if (b && !b.disabled) MapCtl.setBasemap(b.dataset.bm); });
    $('#btn3d').addEventListener('click', () => MapCtl.toggle3D());
    $('#btnFit').addEventListener('click', () => MapCtl.fitVisible(true));
    $('#btnTrails').addEventListener('click', () => MapCtl.toggleTrails());
    $('#btnTerr').addEventListener('click', () => MapCtl.cycleTerrain());
    $('#btnPois').addEventListener('click', () => Pois.toggle());
    MapCtl.on('poi', ({ props, lngLat }) => MapCtl.popup(lngLat, poiPopup(props)));
    $('#btnOffline').addEventListener('click', () => this.openOffline());
    $('#btnOffSave').addEventListener('click', () => {
      const m = MapCtl.view.map, c = m.getCenter();
      let best = null;
      for (const i of Ref.query(c.lng - 0.04, c.lat - 0.03, c.lng + 0.04, c.lat + 0.03)) if (best == null || (Ref.ele[i] ?? 0) > (Ref.ele[best] ?? 0)) best = i;
      const name = (MapCtl.focus && MapCtl.focus.name) || (best != null ? Ref.peak(best).name : 'Zona');
      this.saveZone(this._offBBox, `Zona de ${name}`);
    });
    $('#offList').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-zone]');
      const z = b && Offline.zones().find((x) => x.id === b.dataset.id);
      if (!z) return;
      if (b.dataset.zone === 'see') { $('#dlgOffline').close(); MapCtl.view.fit(z.bbox); if (isMobile()) this.pane('map'); return; }
      $('#dlgOffline').close();
      if (await this.confirm(`¿Borrar la zona guardada «${z.name}»? Tendrás que volver a descargarla para usarla sin cobertura.`, 'Borrar zona')) {
        await Offline.remove(z.id);
        this.toast('Zona borrada.');
      }
    });
    MapCtl.on('routes', ({ ids, lngLat }) => MapCtl.popup(lngLat, routesPopup(ids)));
    MapCtl.on('peak', ({ id }) => MapCtl.focusPeak(id));
    MapCtl.on('osmpeak', ({ props }) => MapCtl.focusPeak(props.id));
    this.initSearch();
    $('#rot3d').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.rot) MapCtl.rotate(+b.dataset.rot);
      else if (b.dataset.tilt) MapCtl.tilt(+b.dataset.tilt);
      else if ('orbit' in b.dataset) MapCtl.orbit();
      else if ('exag' in b.dataset) MapCtl.cycleExag();
      else if ('hd' in b.dataset) MapCtl.toggleHD();
    });
    $('#flybar').addEventListener('click', (e) => {
      const prog = e.target.closest('.fb-prog');
      if (prog) { const rc = prog.getBoundingClientRect(); MapCtl.flySeek((e.clientX - rc.left) / rc.width); return; }
      const b = e.target.closest('[data-fly]');
      if (b) MapCtl.flyCmd(b.dataset.fly);
    });
    MapCtl.on('place', (p) => this.placed(p));
    this.bindDrop();
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(() => {
        const el = $('#prof');
        if (el && S.ui.view === 'route' && Math.abs((el.clientWidth || 0) - (el._w || 0)) > 16) drawProfile(el, S.routes.get(S.ui.routeId));
      });
      this.ro.observe($('#panel'));
    }
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (S.ui.placing) this.stopPlacing();
    });
  },

  fatal(msg) { this.body.innerHTML = `<div class="empty"><h2>No se pudo abrir el cuaderno</h2><p>${esc(msg)}</p></div>`; },

  updateCounts() {
    $('#nRoutes').textContent = S.routes.size ? String(S.routes.size) : '';
    const n = [...mountains().values()].filter((m) => m.climbs.length).length;
    $('#nPeaks').textContent = n ? String(n) : '';
  },

  render() {
    if (!S.loaded) return;
    const v = S.ui.view;
    const tabR = v === 'retos' || v === 'reto' || v === 'plan' || ((v === 'route' || v === 'peak') && (S.ui.prev === 'reto' || S.ui.prev === 'retos'));
    const tabM = !tabR && (v === 'mountains' || v === 'peak' || (v === 'route' && S.ui.prev === 'mountains'));
    const tabS = v === 'stats';
    $('#tabStats').setAttribute('aria-selected', String(tabS));
    $('#tabRoutes').setAttribute('aria-selected', String(!tabM && !tabR && !tabS));
    $('#tabPeaks').setAttribute('aria-selected', String(tabM));
    $('#tabRetos').setAttribute('aria-selected', String(tabR));
    this.updateCounts();
    if (v === 'routes') { this.body.innerHTML = routesView(); this.refreshList(); }
    else if (v === 'mountains') { this.body.innerHTML = mountainsView(); this.renderMountainList(); }
    else if (v === 'route') { this.body.innerHTML = routeDetail(S.ui.routeId); drawProfile($('#prof'), S.routes.get(S.ui.routeId)); }
    else if (v === 'peak') { this.body.innerHTML = peakDetail(S.ui.peakId); wxAuto(); }
    else if (v === 'retos') this.body.innerHTML = retosView();
    else if (v === 'reto') this.body.innerHTML = retoDetail(S.ui.retoId);
    else if (v === 'plan') this.body.innerHTML = Planner.view();
    else if (v === 'stats') this.body.innerHTML = statsView();
    if (v === 'route') { wxAuto(); }
  },

  refreshList() {
    const ul = $('#rlist'), sum = $('#rsum');
    if (!ul) return;
    const all = S.routes.size, list = filteredRoutes();
    let dist = 0, gain = 0;
    for (const r of list) { dist += r.stats?.dist || 0; gain += r.stats?.gain || 0; }
    const hidden = list.filter((r) => isHidden(r.id)).length;
    sum.innerHTML = `<span><b>${list.length}</b>${list.length !== all ? ` de ${all}` : ''} ${all === 1 ? 'ruta' : 'rutas'}, <b>${fmt.km(dist)}</b> y <b>${fmt.m(gain)}</b> de desnivel</span>` +
      (anyFilter() ? '<button class="link" type="button" data-act="clear-filters">Quitar filtros</button>' : hidden ? `<button class="link" type="button" data-act="show-all">${hidden === 1 ? 'Mostrar la oculta' : `Mostrar las ${hidden} ocultas`}</button>` : '');
    ul.innerHTML = list.length ? list.map(routeRow).join('') : '<li class="empty"><p>Ninguna ruta cumple estos filtros.</p></li>';
  },

  renderMountainList() {
    const ul = $('#mlist'), sum = $('#msum');
    if (!ul) return;
    const M = [...mountains().values()];
    const q = norm(S.ui.mq);
    let list = M.filter((m) => m.climbs.length || (S.ui.includeNear && m.nears.length));
    if (q) list = list.filter((m) => norm(m.info.name + ' ' + (m.info.sierra || '')).includes(q));
    list.sort(MSORT[S.ui.sortPeaks] || MSORT.ele);
    const nC = M.filter((m) => m.climbs.length).length, nN = M.filter((m) => !m.climbs.length && m.nears.length).length;
    const top = M.filter((m) => m.climbs.length && m.info.ele != null).sort(MSORT.ele)[0];
    sum.innerHTML = `<span><b>${nC}</b> ${nC === 1 ? 'cumbre subida' : 'cumbres subidas'}${S.ui.includeNear ? `, <b>${nN}</b> solo de paso` : ''}${top ? `. La más alta, ${esc(top.info.name)} (<span class="cota">${fmt.num(top.info.ele)} m</span>)` : ''}</span>`;
    if (!list.length) {
      ul.innerHTML = `<li class="empty"><p>${M.length ? 'Ninguna montaña coincide con la búsqueda.' : 'Todavía no hay cumbres. Cuando tus rutas pasen por alguna, aparecerá aquí.'}</p>${!S.ui.includeNear && nN ? '<p class="small">Activa «Incluir las que pasé cerca» para ver las que rozaste.</p>' : ''}</li>`;
      return;
    }
    let html = '', group = null;
    for (const m of list) {
      if (S.ui.sortPeaks === 'sierra' && (m.info.sierra || '') !== group) {
        group = m.info.sierra || '';
        const n = list.filter((x) => (x.info.sierra || '') === group).length;
        html += `<li class="group-h">${esc(group || 'Sin sierra asignada')} <span class="muted">${n}</span></li>`;
      }
      html += mountainRow(m);
    }
    ul.innerHTML = html;
  },

  saveScroll() { if (['routes', 'mountains', 'retos'].includes(S.ui.view)) this.scroll[S.ui.view] = this.body.scrollTop; },

  go(view) {
    this.saveScroll();
    if (S.ui.placing) this.stopPlacing(false);
    S.ui.view = view === 'mountains' || view === 'retos' || view === 'stats' ? view : 'routes';
    MapCtl.showReto(null);
    Planner.clear();
    S.ui.selRoute = null;
    MapCtl.selectRoute(null);
    MapCtl.selectPeak(null);
    this.render();
    this.body.scrollTop = this.scroll[S.ui.view] || 0;
  },

  openRoute(id, fit = true) {
    if (!S.routes.has(id)) return;
    this.saveScroll();
    if (['routes', 'mountains', 'retos', 'reto', 'stats'].includes(S.ui.view)) S.ui.prev = S.ui.view;
    Object.assign(S.ui, { view: 'route', routeId: id, selRoute: id, profAt: null, alpOpen: {}, addPeakOpen: false, newPeak: null, showDiscarded: false, addPeakQ: '' });
    MapCtl.closePopup();
    this.render();
    this.body.scrollTop = 0;
    MapCtl.selectPeak(null);
    MapCtl.selectRoute(id, fit);
    if (isMobile()) this.pane('panel');
  },

  openPeak(id) {
    this.saveScroll();
    if (['routes', 'mountains', 'retos', 'reto', 'stats'].includes(S.ui.view)) S.ui.prev = S.ui.view;
    Object.assign(S.ui, { view: 'peak', peakId: id });
    MapCtl.closePopup();
    this.render();
    this.body.scrollTop = 0;
    MapCtl.selectPeak(id, true);
    if (isMobile()) this.pane('panel');
  },

  onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id;
    if (el.tagName === 'BUTTON' && el.closest('li[data-act]') && act !== el.closest('li[data-act]').dataset.act) e.stopPropagation();
    switch (act) {
      case 'open-route': return this.openRoute(id, true);
      case 'export-gpx': return exportRouteGpx(S.ui.routeId);
      case 'alp-gear': el.setAttribute('aria-pressed', String(Actions.toggleGear(S.ui.routeId, id))); return;
      case 'alp-partner': { const cur = alpOf(S.routes.get(S.ui.routeId)).team || []; if (!cur.includes(id)) { Actions.setAlp(S.ui.routeId, 'team', [...cur, id].join(', ')); this.render(); } return; }
      case 'wp-add': if (S.ui.profAt != null) { Actions.addWp(S.ui.routeId, S.ui.profAt, $('#wpKind').value, $('#wpName').value); this.rerenderRoute(); } return;
      case 'wp-del': Actions.removeWp(S.ui.routeId, +id); this.rerenderRoute(); return;
      case 'stats-year': S.ui.filters = { year: id, type: '', sierra: '', peak: '', q: '' }; this.go('routes'); MapCtl.syncVisible(); MapCtl.fitVisible(true); return;
      case 'terrain-run': return Terrain.run(S.ui.routeId);
      case 'wx-load': return Wx.load(el.closest('[data-wx]'), true);
      case 'open-peak': return this.openPeak(id);
      case 'open-reto': return this.openReto(id);
      case 'plan-reto': return Planner.open(S.ui.retoId);
      case 'plan-run': return Planner.run();
      case 'plan-pick': return Planner.pick();
      case 'plan-mode': return Planner.set('mode', id);
      case 'plan-gpx': return Planner.gpx();
      case 'plan-offline': return Planner.offline();
      case 'plan-fit': Planner.show(true); if (isMobile()) this.pane('map'); return;
      case 'reto-peak': MapCtl.focusPeak(id); if (isMobile()) this.pane('map'); return;
      case 'offline-route': {
        const r = S.routes.get(S.ui.routeId);
        if (!r) return;
        const P = r._P;
        let w = 180, s = 90, e = -180, n = -90;
        for (let i = 0; i < P.n; i++) { w = Math.min(w, P.lon[i]); e = Math.max(e, P.lon[i]); s = Math.min(s, P.lat[i]); n = Math.max(n, P.lat[i]); }
        return this.saveZone([w - 0.02, s - 0.015, e + 0.02, n + 0.015], r.name);
      }
      case 'toggle-route': Actions.toggleHidden(id); this.refreshList(); MapCtl.syncVisible(); return;
      case 'show-all': Actions.showAll(); this.refreshList(); MapCtl.syncVisible(); return;
      case 'clear-filters': S.ui.filters = { year: '', type: '', sierra: '', peak: '', q: '' }; this.render(); MapCtl.syncVisible(); MapCtl.fitVisible(true); return;
      case 'back':
        if (S.ui.view === 'plan') { Planner.clear(); return this.openReto(S.ui.retoId); }
        if (S.ui.view === 'reto') return this.go('retos');
        return S.ui.prev === 'reto' ? this.openReto(S.ui.retoId) : this.go(S.ui.prev || 'routes');
      case 'decide': Actions.setDecision(S.ui.routeId, id, el.dataset.v); this.afterPeakChange(); return;
      case 'decide-in': Actions.setDecision(el.dataset.route, id, 'climbed'); this.afterPeakChange(); return;
      case 'undecide': Actions.setDecision(S.ui.routeId, id, null); this.afterPeakChange(); return;
      case 'remove-peak': Actions.removePeak(S.ui.routeId, id); this.afterPeakChange(); return;
      case 'toggle-discarded': S.ui.showDiscarded = !S.ui.showDiscarded; this.render(); return;
      case 'add-peak':
        S.ui.addPeakOpen = !S.ui.addPeakOpen; S.ui.addPeakQ = ''; S.ui.newPeak = null;
        this.render();
        if (S.ui.addPeakOpen) $('#addq')?.focus();
        return;
      case 'pick-peak': {
        const p = Ref.peak(+el.dataset.i);
        Actions.addPeakToRoute(S.ui.routeId, p);
        S.ui.addPeakOpen = false;
        this.afterPeakChange();
        this.toast(`Cumbre añadida: ${p.name}.`);
        return;
      }
      case 'pick-custom': {
        const c = S.data.customPeaks[id];
        if (!c) return;
        Actions.addPeakToRoute(S.ui.routeId, { id, ...c });
        S.ui.addPeakOpen = false;
        this.afterPeakChange();
        this.toast(`Cumbre añadida: ${c.name}.`);
        return;
      }
      case 'place-peak': return this.startPlacing();
      case 'cancel-place': return this.stopPlacing();
      case 'save-new-peak': return this.saveNewPeak();
      case 'fit-route': MapCtl.selectRoute(S.ui.routeId, true); if (isMobile()) this.pane('map'); return;
      case 'fly-route': MapCtl.flyRoute(S.ui.routeId); if (isMobile()) this.pane('map'); return;
      case 'delete-route': return this.deleteRoute(S.ui.routeId);
      case 'peak-map': MapCtl.selectPeak(id, true); if (isMobile()) this.pane('map'); return;
      case 'mfilter':
        S.ui.filters = { year: '', type: '', sierra: '', peak: id, q: '' };
        if (!(mountains().get(id)?.climbs.length)) S.ui.includeNear = true;
        this.go('routes'); MapCtl.syncVisible(); MapCtl.fitVisible(true);
        return;
      case 'reset-peak': Actions.resetPeak(id); this.afterPeakChange(); return;
      case 'delete-peak': return this.deleteCustomPeak(id);
      case 'add-files': return $('#inGpx').click();
      case 'dismiss-note': MapCtl.dismissNote(); return;
      case 'clear-focus': MapCtl.clearFocus(); MapCtl.closePopup(); return;
      case 'load-demo': return this.loadDemo();
      case 'delete-demo': return this.deleteDemo();
    }
  },

  afterPeakChange() { this.render(); MapCtl.syncVisible(); },
  /** Vuelve a pintar la ficha de ruta sin perder la posición ni los desplegables abiertos. */
  rerenderRoute() { const y = this.body.scrollTop; this.render(); this.body.scrollTop = y; },

  onChange(e) {
    const t = e.target;
    if (t.dataset && t.dataset.plan) { Planner.set(t.dataset.plan, t.value); return; }
    if (t.dataset && t.dataset.reto) {
      if (t.dataset.reto === 'sort') S.ui.retoSort = t.value; else S.ui.retoPend = t.checked;
      this.render();
      return;
    }
    if (t.dataset.f) {
      S.ui.filters[t.dataset.f] = t.value;
      this.refreshList(); MapCtl.syncVisible();
      if (t.dataset.f !== 'q') MapCtl.fitVisible(true);
      return;
    }
    if (t.dataset.alp) {
      const p = t.dataset.alp;
      Actions.setAlp(S.ui.routeId, p, t.value);
      if (p.startsWith('plan.')) { const y = this.body.scrollTop; $('#schedBox').innerHTML = scheduleSection(S.routes.get(S.ui.routeId)); this.body.scrollTop = y; }
      else if (t.tagName === 'SELECT' || p === 'team') this.rerenderRoute();
      if (p === 'status') { this.updateCounts(); MapCtl.syncVisible(); }
      return;
    }
    if (t.dataset.edit) {
      Actions.setRouteField(S.ui.routeId, t.dataset.edit, t.value);
      if (t.dataset.edit !== 'name') this.render();
      MapCtl.syncVisible();
      return;
    }
    if (t.dataset.pedit) { Actions.editPeak(S.ui.peakId, t.dataset.pedit, t.value); this.render(); MapCtl.syncVisible(); return; }
    if (t.dataset.m === 'sort') { S.ui.sortPeaks = t.value; this.renderMountainList(); return; }
    if (t.dataset.m === 'near') { S.ui.includeNear = t.checked; this.renderMountainList(); return; }
  },

  onInput(e) {
    const t = e.target;
    if (t.dataset.f === 'q') { S.ui.filters.q = t.value; this.refreshList(); MapCtl.syncVisible(); return; }
    if (t.dataset.m === 'q') { S.ui.mq = t.value; this.renderMountainList(); return; }
    if (t.id === 'addq') {
      S.ui.addPeakQ = t.value;
      clearTimeout(this._addT);
      this._addT = setTimeout(() => { const ul = $('#addres'); if (ul) ul.innerHTML = addResults(S.routes.get(S.ui.routeId)); }, 160);
    }
  },

  pane(p) {
    document.body.dataset.pane = p;
    $$('#switcher button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pane === p)));
    if (p === 'map') setTimeout(() => MapCtl.resize(), 30);
  },

  /* Cumbre nueva marcada en el mapa */
  startPlacing() {
    S.ui.placing = S.ui.routeId;
    document.body.classList.add('placing');
    MapCtl.note('<b>Marca la cumbre.</b> Pulsa en el mapa donde está la cima. <button class="link" type="button" data-act="cancel-place">Cancelar</button>', true);
    MapCtl.selectRoute(S.ui.routeId, true);
    if (isMobile()) this.pane('map');
  },
  stopPlacing(rerender = true) {
    S.ui.placing = null; S.ui.newPeak = null;
    document.body.classList.remove('placing');
    MapCtl.restoreNote();
    MapCtl.setCursor(null);
    if (rerender) this.render();
  },
  placed({ lat, lon }) {
    if (S.ui.placing === 'plan-start') return Planner.placed(lat, lon);
    const r = S.routes.get(S.ui.placing);
    if (!r) return this.stopPlacing();
    const near = nearestOnTrack(r._P, lat, lon);
    const ele = near.d < 150 && r._P.ele ? Math.round(eleAt(r._P, near.at)) : null;
    S.ui.placing = null;
    document.body.classList.remove('placing');
    MapCtl.restoreNote();
    S.ui.newPeak = { lat, lon, ele, d: near.d, name: '' };
    S.ui.addPeakOpen = true;
    this.render();
    if (isMobile()) this.pane('panel');
    MapCtl.setCursor(lat, lon);
    $('#npName')?.focus();
  },
  saveNewPeak() {
    const name = ($('#npName')?.value || '').trim();
    if (!name) { this.toast('Ponle nombre a la cumbre.', { err: true }); $('#npName')?.focus(); return; }
    const np = S.ui.newPeak;
    if (!np) return;
    Actions.createCustomPeak({ name, ele: $('#npEle')?.value, lat: np.lat, lon: np.lon }, S.ui.routeId);
    S.ui.newPeak = null; S.ui.addPeakOpen = false;
    MapCtl.setCursor(null);
    this.afterPeakChange();
    this.toast(`Cumbre guardada: ${name}.`);
  },

  async deleteRoute(id) {
    const r = S.routes.get(id);
    if (!r) return;
    if (!(await this.confirm(`¿Borrar ${routeQuote(r.name)} del cuaderno? No se puede deshacer.`, 'Borrar ruta'))) return;
    try { await Actions.deleteRoute(id); }
    catch (e) { this.toast(storeErrorMessage(e), { err: true }); return; }
    S.ui.selRoute = null;
    MapCtl.syncAll();
    this.go(S.ui.prev || 'routes');
    this.toast('Ruta borrada.');
  },
  async deleteCustomPeak(id) {
    const c = S.data.customPeaks[id];
    if (!c) return;
    if (!(await this.confirm(`¿Borrar la cumbre ${routeQuote(c.name)}? Desaparecerá de todas tus rutas.`, 'Borrar cumbre'))) return;
    Actions.deleteCustomPeak(id);
    MapCtl.syncVisible();
    this.go(S.ui.prev || 'mountains');
    this.toast('Cumbre borrada.');
  },

  /* Archivos */
  bindDrop() {
    let depth = 0;
    const ov = $('#drop');
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.hidden = false; });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; ov.hidden = true;
      this.addFiles([...e.dataTransfer.files]);
    });
  },
  async addFiles(files) {
    const gpx = files.filter((f) => RouteSources.gpx.accepts(f) || RouteSources.fit.accepts(f));
    const json = files.filter((f) => /\.json$/i.test(f.name));
    if (!gpx.length && json.length) return this.importFile(json[0]);
    if (!gpx.length) return this.toast('Se admiten archivos .gpx y .fit (o una exportación .json del cuaderno).', { err: true });
    if (!S.loaded) return this.toast('Espera a que termine de cargar el cuaderno.', { err: true });
    this.progress(0, gpx.length, 'Leyendo tracks');
    let res;
    try { res = await importGpxFiles(gpx); }
    finally { this.progressDone(); }
    MapCtl.syncAll();
    const parts = [];
    if (res.added.length) {
      const peaks = new Set();
      for (const r of res.added) for (const pe of r.peaks) if (statusOf(r, pe) === 'climbed') peaks.add(pe.id);
      const pk = peaks.size ? `, con ${peaks.size === 1 ? '1 cumbre' : peaks.size + ' cumbres'}` : '';
      parts.push(res.added.length === 1 ? `Ruta añadida: ${res.added[0].name}${pk}` : `${res.added.length} rutas añadidas${pk}`);
    }
    if (res.duplicates.length) parts.push(res.duplicates.length === 1 ? `${res.duplicates[0].name} ya estaba en el cuaderno y no se ha duplicado` : `${res.duplicates.length} ya estaban en el cuaderno y no se han duplicado`);
    if (res.errors.length) parts.push(`${res.errors.length === 1 ? 'Un archivo no se pudo leer' : res.errors.length + ' archivos no se pudieron leer'} (${res.errors.slice(0, 2).map((x) => `${x.name}: ${x.msg}`).join('; ')})`);
    this.toast(parts.join('. ') + '.', { err: !res.added.length && res.errors.length > 0, timeout: 8000 });
    if (res.added.length === 1) this.openRoute(res.added[0].id, true);
    else { this.render(); if (res.added.length) MapCtl.fitRoutes(res.added.map((r) => r.id)); }
  },
  async importFile(f) {
    let obj;
    try { obj = JSON.parse(await f.text()); }
    catch { this.toast('El archivo no es un JSON válido.', { err: true }); return; }
    if (!S.loaded) return;
    try {
      this.progress(0, obj?.routes?.length || 1, 'Importando');
      const res = await importPayload(obj, (a, b) => this.progress(a, b, 'Importando'));
      this.progressDone();
      if ($('#dlgData').open) $('#dlgData').close();
      this.render(); MapCtl.syncAll(); MapCtl.fitVisible(true);
      this.toast(`Datos importados: ${res.added === 1 ? '1 ruta nueva' : res.added + ' rutas nuevas'}${res.updated ? `, ${res.updated} actualizadas` : ''}${res.same ? `, ${res.same} ya estaban al día` : ''}${res.errors ? `, ${res.errors} no se pudieron leer` : ''}.`, { timeout: 7000 });
    } catch (e) {
      this.progressDone();
      this.toast(e.message || String(e), { err: true, timeout: 7000 });
    }
  },
  async doExport() {
    const json = JSON.stringify(exportPayload());
    const name = `cuaderno-de-cumbres-${new Date().toISOString().slice(0, 10)}.json`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    this.toast('Datos exportados.');
  },
  async loadDemo() {
    if (!S.loaded) return;
    let obj;
    try { obj = JSON.parse(utf8.decode(await embedded('d-demo'))); }
    catch { this.toast('No se pudieron preparar las rutas de ejemplo.', { err: true }); return; }
    try {
      this.progress(0, obj.routes.length, 'Cargando ejemplos');
      const res = await importPayload(obj, (a, b) => this.progress(a, b, 'Cargando ejemplos'));
      this.progressDone();
      if ($('#dlgData').open) $('#dlgData').close();
      S.ui.filters = { year: '', type: '', sierra: '', peak: '', q: '' };
      this.go('routes'); MapCtl.syncAll(); MapCtl.fitVisible(true);
      this.toast(res.added ? `Rutas de ejemplo cargadas: ${res.added}.` : 'Las rutas de ejemplo ya estaban en el cuaderno.');
    } catch (e) { this.progressDone(); this.toast(e.message || String(e), { err: true }); }
  },
  async deleteDemo() {
    const ids = [...S.routes.values()].filter((r) => r.source && r.source.kind === 'demo').map((r) => r.id);
    if (!ids.length) return;
    if (!(await this.confirm(`¿Borrar las ${ids.length} rutas de ejemplo? Tus rutas no se tocan.`, 'Borrar ejemplos'))) return;
    this.progress(0, ids.length, 'Borrando ejemplos');
    let k = 0;
    for (const id of ids) {
      try { await Actions.deleteRoute(id); } catch (e) { this.toast(storeErrorMessage(e), { err: true }); break; }
      this.progress(++k, ids.length, 'Borrando ejemplos');
    }
    this.progressDone();
    if ($('#dlgData').open) $('#dlgData').close();
    S.ui.filters = { year: '', type: '', sierra: '', peak: '', q: '' };
    MapCtl.syncAll(); this.go('routes');
    this.toast('Rutas de ejemplo borradas.');
  },
  async wipe() {
    if (!(await this.confirm('¿Borrar todo el cuaderno? Se eliminarán todas las rutas, cumbres añadidas y correcciones. Exporta antes tus datos si quieres conservarlos.', 'Borrar todo'))) return;
    this.progress(0, 1, 'Borrando');
    try { await Actions.deleteAll(); } catch (e) { this.toast(storeErrorMessage(e), { err: true }); }
    this.progressDone();
    $('#dlgData').close();
    S.ui.filters = { year: '', type: '', sierra: '', peak: '', q: '' };
    MapCtl.syncAll();
    this.go('routes');
    this.toast('Cuaderno borrado.');
  },
  openData() {
    const mode = S.store?.mode;
    $('#storeInfo').textContent = mode === 'browser'
      ? 'Solo en este dispositivo, dentro del navegador. Nada se envía a ningún servidor. Para llevarlo a otro dispositivo o tener copia de seguridad, exporta aquí e importa allí.'
      : 'En ningún sitio: este navegador no permite guardar (¿modo privado?). Exporta tus datos antes de cerrar.';
    $('#btnDemoDel').disabled = !demoCount();
    $('#dlgData').showModal();
  },
  openSettings() {
    $('#setSummit').value = S.data.settings.summitM;
    $('#setNear').value = S.data.settings.nearM;
    const raw = new Set();
    for (const m of mountains().values()) {
      if (m.id.startsWith('u:') || S.data.peakEdits[m.id]?.sierra != null) continue;
      const i = Ref.idIndex.get(m.id);
      if (i !== undefined && Ref.sier[i] >= 0) raw.add(Ref.sierras[Ref.sier[i]].name);
    }
    for (const r of S.routes.values()) {
      const P = r._P, step = Math.max(1, Math.floor(P.n / 20));
      for (let i = 0; i < P.n; i += step) { const s = Ref.sierraAt(P.lon[i], P.lat[i], false); if (s) raw.add(s); }
    }
    const list = [...raw].sort((a, b) => a.localeCompare(b, 'es'));
    $('#sierraEdit').innerHTML = list.length
      ? list.map((s) => `<label><span>${esc(s)}</span><input type="text" data-orig="${esc(s)}" value="${esc(S.data.sierraRenames[s] || '')}" placeholder="${esc(s)}" aria-label="Nuevo nombre para ${esc(s)}"></label>`).join('')
      : '<p class="small muted">Aparecerán aquí las sierras por las que pasen tus rutas.</p>';
    const glv = (() => { try { const c = document.createElement('canvas'); return c.getContext('webgl2') ? 'WebGL 2' : c.getContext('webgl') ? 'WebGL 1' : 'sin WebGL'; } catch { return 'sin WebGL'; } })();
    $('#diag').textContent = `Diagnóstico: mapa ${MapCtl.kind === 'maplibre' ? 'MapLibre, con 3D' : `sin cargar (${MapCtl.why || 'motivo desconocido'})`}; ${glv}; relieve ${Net.dem === 'mapterhorn' ? 'Mapterhorn, 2 m' : Net.dem === 'aws' ? 'AWS, 30 m' : 'no disponible'}; HD ${MapCtl.hd ? 'activado' : 'desactivado'}${MapCtl.lastError ? `; último error: ${MapCtl.lastError}` : ''}.`;
    $('#dlgSettings').showModal();
  },
  applyThresholds() {
    Actions.setThresholds($('#setSummit').value, $('#setNear').value);
    $('#setSummit').value = S.data.settings.summitM;
    $('#setNear').value = S.data.settings.nearM;
    this.render(); MapCtl.syncVisible();
    this.toast(`Umbrales aplicados: cumbre a menos de ${S.data.settings.summitM} m, cerca a menos de ${S.data.settings.nearM} m.`);
  },
  async redetect() {
    $('#dlgSettings').close();
    this.progress(0, S.routes.size, 'Cruzando con OSM');
    const n = await Actions.redetectAll((a, b) => this.progress(a, b, 'Cruzando con OSM'));
    this.progressDone();
    this.render(); MapCtl.syncVisible();
    this.toast(n ? `Cruce terminado: ${n === 1 ? '1 ruta actualizada' : n + ' rutas actualizadas'}.` : 'Cruce terminado: no ha cambiado nada.');
  },

  profileAt(routeId, at) { const el = $('#prof'); if (el && el._routeId === routeId && el._showAt) el._showAt(at); },

  /* Buscador del mapa */
  initSearch() {
    const inp = $('#mq'), ul = $('#mqres');
    let items = [], active = -1, timer = null;
    const close = () => { ul.hidden = true; inp.setAttribute('aria-expanded', 'false'); active = -1; };
    const paint = () => {
      $$('.mq-item', ul).forEach((li, k) => li.setAttribute('aria-selected', String(k === active)));
      const li = ul.querySelector(`[data-k="${active}"]`);
      if (li) { li.scrollIntoView({ block: 'nearest' }); inp.setAttribute('aria-activedescendant', li.id); }
    };
    const run = () => {
      if (!S.loaded || !Ref.ready) return;
      items = searchEverything(inp.value);
      active = items.length ? 0 : -1;
      if (inp.value.trim().length < 2) { close(); return; }
      ul.innerHTML = items.length ? items.map(searchItemHtml).join('') : '<li class="mq-empty">Sin resultados</li>';
      ul.hidden = false; inp.setAttribute('aria-expanded', 'true');
      paint();
    };
    const pick = (k) => {
      const it = items[k];
      if (!it) return;
      close(); inp.blur();
      this.pickSearch(it);
    };
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    inp.addEventListener('focus', () => { if (inp.value.trim().length >= 2) run(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); active = (active + 1) % items.length; paint(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); active = (active - 1 + items.length) % items.length; paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (ul.hidden) run(); pick(Math.max(0, active)); }
      else if (e.key === 'Escape') { close(); inp.value = ''; }
    });
    ul.addEventListener('mousedown', (e) => e.preventDefault());
    ul.addEventListener('click', (e) => { const li = e.target.closest('.mq-item'); if (li) pick(+li.dataset.k); });
    document.addEventListener('click', (e) => { if (!e.target.closest('#mapSearch')) close(); });
  },
  pickSearch(it) {
    if (it.kind === 'route') { this.openRoute(it.id, true); return; }
    if (isMobile()) this.pane('map');
    if (it.kind === 'peak') MapCtl.focusPeak(it.id);
    else if (it.kind === 'sierra') { MapCtl.clearFocus(); MapCtl.closePopup(); MapCtl.focusSierra(it.id); }
    else if (it.kind === 'place') MapCtl.centerOn(it.lat, it.lon, 12);
  },

  syncChanged() {
    const w = $('#where');
    if (w && S.store) w.textContent = S.store.mode === 'browser' ? 'Guardado en este dispositivo' : 'Sin guardar';
  },

  /* Avisos y confirmaciones */
  toast(msg, { err = false, timeout = 4500 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.setAttribute('role', err ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), timeout);
    return el;
  },
  progress(a, b, label = 'Procesando') {
    if (!this.progEl) {
      this.progEl = document.createElement('div');
      this.progEl.className = 'toast';
      this.progEl.innerHTML = '<span class="pl"></span><span class="bar-p"><i></i></span>';
      $('#toasts').appendChild(this.progEl);
    }
    this.progEl.querySelector('.pl').textContent = `${label}: ${a} de ${b}`;
    this.progEl.querySelector('i').style.width = (b ? (100 * a) / b : 0) + '%';
  },
  progressDone() { if (this.progEl) { this.progEl.remove(); this.progEl = null; } },
  confirm(text, okLabel = 'Borrar') {
    const d = $('#dlgConfirm');
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = okLabel;
    return new Promise((res) => {
      const done = (v) => { d.onclose = null; $('#confirmYes').onclick = null; $('#confirmNo').onclick = null; if (d.open) d.close(); res(v); };
      $('#confirmYes').onclick = () => done(true);
      $('#confirmNo').onclick = () => done(false);
      d.onclose = () => done(false);
      d.showModal();
      $('#confirmNo').focus();
    });
  },
};
