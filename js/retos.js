'use strict';
/* ===================== 13. Retos de cumbres ===================== */
const RETOS = [
  { id: 'guadarrama2000', name: 'Dosmiles de Guadarrama', sub: 'Cumbres de 2000 m o más de la Sierra de Guadarrama', sierra: 'Sierra de Guadarrama', min: 2000 },
  { id: 'gredos2000', name: 'Dosmiles de Gredos', sub: 'Cumbres de 2000 m o más de la Sierra de Gredos', sierra: 'Sierra de Gredos', min: 2000 },
  { id: 'picos2500', name: 'Picos de Europa por encima de 2500 m', sub: 'Cumbres de 2500 m o más de los tres macizos', sierra: 'Picos de Europa', min: 2500 },
  { id: 'nevada3000', name: 'Tresmiles de Sierra Nevada', sub: 'Cumbres de 3000 m o más de Sierra Nevada', sierra: 'Sierra Nevada', min: 3000 },
  { id: 'pirineo3000', name: 'Tresmiles del Pirineo', sub: 'Cumbres de 3000 m o más del Pirineo, a ambos lados de la frontera', box: [-1.0, 42.3, 2.6, 43.05], min: 3000 },
  { id: 'techos', name: 'Techos de provincia', sub: 'La cumbre más alta de cada provincia; las de frontera cuentan para las dos', techos: true },
];
const retoCache = {};
/** Elementos de un reto: [{id de cumbre, etiqueta opcional (provincia)}], ordenados por altitud. */
function retoItems(r) {
  if (retoCache[r.id]) return retoCache[r.id];
  let items = [];
  if (r.techos) items = TECHOS.filter((t) => Ref.idIndex.has(t.id)).map((t) => ({ id: t.id, tag: t.p }));
  else {
    for (let i = 0; i < Ref.n; i++) {
      if (!(Ref.ele[i] >= r.min)) continue;
      if (r.sierra && (Ref.sier[i] < 0 || Ref.sierras[Ref.sier[i]].name !== r.sierra)) continue;
      if (r.box && (Ref.lon[i] < r.box[0] || Ref.lat[i] < r.box[1] || Ref.lon[i] > r.box[2] || Ref.lat[i] > r.box[3])) continue;
      items.push({ id: 'osm:' + Ref.ids[i] });
    }
  }
  for (const it of items) { const p = peakInfo(it.id); it.name = p.name; it.ele = p.ele; it.lat = p.lat; it.lon = p.lon; it.sierra = p.sierra; }
  items.sort((a, b) => (b.ele ?? 0) - (a.ele ?? 0) || (a.tag || '').localeCompare(b.tag || '', 'es'));
  return (retoCache[r.id] = items);
}
function retoStatus(id) {
  const m = mountains().get(id);
  return m && m.climbs.length ? 'climbed' : m && m.nears.length ? 'near' : 'todo';
}
function retoProgress(r) {
  const items = retoItems(r);
  return { done: items.filter((it) => retoStatus(it.id) === 'climbed').length, total: items.length };
}
function retosView() {
  if (!Ref.ready) return '<div class="loading">Preparando los retos…</div>';
  return `<p class="retos-intro small muted">Cumbres según OpenStreetMap. Cuentan las que has subido en tus rutas.</p>
  <ul class="list">${RETOS.map((r) => {
    const { done, total } = retoProgress(r);
    return `<li class="reto" data-act="open-reto" data-id="${r.id}" tabindex="0">
      <div class="reto-h"><b>${esc(r.name)}</b><span class="reto-n"><b>${done}</b> de ${total}</span></div>
      <div class="reto-bar" aria-hidden="true"><i style="width:${total ? ((100 * done) / total).toFixed(1) : 0}%"></i></div>
      <div class="small muted">${esc(r.sub)}</div>
    </li>`;
  }).join('')}</ul>`;
}
function retoDetail(id) {
  const r = RETOS.find((x) => x.id === id);
  if (!r) return '';
  const { done, total } = retoProgress(r);
  let items = retoItems(r).map((it) => ({ ...it, st: retoStatus(it.id) }));
  if (S.ui.retoPend) items = items.filter((it) => it.st !== 'climbed');
  const sort = S.ui.retoSort || 'ele';
  if (sort === 'near' && MapCtl.view) {
    const c = MapCtl.view.map ? MapCtl.view.map.getCenter() : MapCtl.view.map.getCenter();
    for (const it of items) it.dist = haversine(c.lat, c.lng, it.lat, it.lon);
    items.sort((a, b) => a.dist - b.dist);
  } else if (sort === 'todo') items.sort((a, b) => (a.st === 'climbed') - (b.st === 'climbed') || (b.ele ?? 0) - (a.ele ?? 0));
  const rows = items.map((it) => {
    const m = mountains().get(it.id);
    const when = it.st === 'climbed' ? `Subida el ${fmt.date(m.climbs[m.climbs.length - 1].date)}${m.climbs.length > 1 ? ` y ${fmt.times(m.climbs.length - 1)} más` : ''}` : it.st === 'near' ? 'Pasaste cerca' : 'Pendiente';
    const extra = it.dist != null ? `, a ${fmt.km(it.dist)} del centro del mapa` : '';
    return `<li class="mountain" data-act="reto-peak" data-id="${esc(it.id)}" tabindex="0">
      ${VTX(it.st === 'todo' ? 'osm' : it.st, 16)}
      <div><div class="m-name">${it.tag ? `${esc(it.tag)}: ` : ''}${esc(it.name)}</div>
        ${it.sierra && !it.tag ? `<div class="m-sierra">${esc(it.sierra)}</div>` : ''}
        <div class="m-when">${when}${extra}</div></div>
      <div class="m-right"><span class="m-ele cota">${it.ele != null ? fmt.num(it.ele) : '—'}</span></div>
    </li>`;
  }).join('');
  return `<div class="detail">
    <div class="d-head">
      <button class="btn quiet small back" type="button" data-act="back">‹ Retos</button>
      <h2 class="reto-title">${esc(r.name)}</h2>
      <p class="small muted" style="margin:2px 0 10px">${esc(r.sub)}</p>
      <div class="reto-h"><span><b>${done}</b> de ${total} ${r.techos ? 'provincias' : 'cumbres'}</span><span class="small muted">${total ? Math.round((100 * done) / total) : 0} %</span></div>
      <div class="reto-bar" aria-hidden="true"><i style="width:${total ? ((100 * done) / total).toFixed(1) : 0}%"></i></div>
      ${typeof Pois !== 'undefined' && Pois.available() ? '<button class="btn small" type="button" data-act="plan-reto" style="margin-top:10px">Planificar una ruta para este reto</button>' : ''}
      <div class="row" style="margin-top:10px">
        <select data-reto="sort" aria-label="Orden">${[['ele', 'Por altitud'], ['todo', 'Pendientes primero'], ['near', 'Más cerca del centro del mapa']].map(([v, l]) => `<option value="${v}"${sort === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" data-reto="pend"${S.ui.retoPend ? ' checked' : ''}> Solo pendientes</label>
      </div>
    </div>
    <ul class="list">${rows || '<li class="empty"><p>¡Reto completado!</p></li>'}</ul>
  </div>`;
}
UI.openReto = function (id) {
  this.saveScroll();
  S.ui.prev = 'retos';
  Object.assign(S.ui, { view: 'reto', retoId: id });
  this.render();
  this.body.scrollTop = 0;
  const r = RETOS.find((x) => x.id === id);
  if (r) MapCtl.showReto(retoItems(r).map((it) => ({ ...it, st: retoStatus(it.id) })), true);
};
