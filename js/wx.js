'use strict';
/* ===================== 19. Meteo de montaña y boletines de aludes =====================
   Previsión a 7 días de Open-Meteo (https://open-meteo.com, datos CC BY 4.0, sin clave ni cuenta)
   ajustada a la altitud del punto: temperaturas, viento y rachas, precipitación, nieve nueva e
   isoterma de 0 °C. La última previsión de cada punto se guarda en el dispositivo y se enseña
   también sin cobertura, indicando de cuándo es.

   El peligro de aludes no tiene una fuente abierta única: se enlaza el boletín oficial de la zona. */
const WX_CODES = {
  0: ['Despejado', '☀'], 1: ['Poco nuboso', '🌤'], 2: ['Nubes y claros', '⛅'], 3: ['Cubierto', '☁'], 45: ['Niebla', '🌫'], 48: ['Niebla engelante', '🌫'],
  51: ['Llovizna', '🌦'], 53: ['Llovizna', '🌦'], 55: ['Llovizna', '🌧'], 56: ['Llovizna helada', '🌧'], 57: ['Llovizna helada', '🌧'],
  61: ['Lluvia débil', '🌦'], 63: ['Lluvia', '🌧'], 65: ['Lluvia fuerte', '🌧'], 66: ['Lluvia helada', '🌧'], 67: ['Lluvia helada', '🌧'],
  71: ['Nevada débil', '🌨'], 73: ['Nevada', '🌨'], 75: ['Nevada fuerte', '❄'], 77: ['Cinarra', '🌨'],
  80: ['Chubascos', '🌦'], 81: ['Chubascos', '🌧'], 82: ['Chubascos fuertes', '⛈'], 85: ['Chubascos de nieve', '🌨'], 86: ['Chubascos de nieve', '❄'],
  95: ['Tormenta', '⛈'], 96: ['Tormenta con granizo', '⛈'], 99: ['Tormenta con granizo', '⛈'],
};
const WX_TTL = 3 * 3600 * 1000;
const Wx = {
  key: (lat, lon, ele) => `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round((ele || 0) / 100)}`,
  store() { try { return JSON.parse(localStorage.getItem('cc-wx') || '{}'); } catch { return {}; } },
  cached(lat, lon, ele) { return this.store()[this.key(lat, lon, ele)] || null; },
  save(lat, lon, ele, data) {
    const st = this.store();
    st[this.key(lat, lon, ele)] = { t: Date.now(), data };
    const keys = Object.keys(st).sort((a, b) => st[b].t - st[a].t);
    for (const k of keys.slice(30)) delete st[k];
    try { localStorage.setItem('cc-wx', JSON.stringify(st)); } catch {}
  },
  async fetch(lat, lon, ele) {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${ele != null ? `&elevation=${Math.round(ele)}` : ''}` +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset' +
      '&hourly=freezing_level_height&timezone=auto&forecast_days=7&wind_speed_unit=kmh';
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(u, { signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 429 ? 'El servicio de meteo está saturado; prueba en un rato.' : 'El servicio de meteo no responde (' + res.status + ').');
      const js = await res.json(), d = js.daily, h = js.hourly || {};
      const days = d.time.map((day, i) => {
        let lo = null, hi = null;
        (h.time || []).forEach((t, k) => { if (t.startsWith(day) && h.freezing_level_height[k] != null) { const v = h.freezing_level_height[k]; lo = lo == null ? v : Math.min(lo, v); hi = hi == null ? v : Math.max(hi, v); } });
        return { day, code: d.weather_code[i], tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], rain: d.precipitation_sum[i], snow: d.snowfall_sum[i], wind: d.wind_speed_10m_max[i], gust: d.wind_gusts_10m_max[i], rise: (d.sunrise[i] || '').slice(11, 16), set: (d.sunset[i] || '').slice(11, 16), iso0: lo, iso1: hi };
      });
      const data = { ele: js.elevation, days };
      this.save(lat, lon, ele, data);
      return data;
    } finally { clearTimeout(timer); }
  },
  html(c, ele) {
    const r0 = (v) => (v == null ? '—' : Math.round(v));
    const rows = c.data.days.map((d) => {
      const [txt, ico] = WX_CODES[d.code] || ['', ''];
      const dt = new Date(d.day + 'T12:00:00');
      const below = ele != null && d.iso0 != null && d.iso0 > ele;
      return `<tr${d.gust >= 70 || [95, 96, 99].includes(d.code) ? ' class="late"' : ''}>
        <td><b>${dt.toLocaleDateString('es-ES', { weekday: 'short' })}</b> ${dt.getDate()}<br><span class="small muted">${ico} ${txt}</span></td>
        <td class="num">${r0(d.tmin)} / ${r0(d.tmax)}°</td>
        <td class="num">${r0(d.wind)}<br><span class="small muted">${r0(d.gust)}</span></td>
        <td class="num">${d.snow >= 0.5 ? `${NF1.format(d.snow)} cm` : d.rain >= 0.2 ? `${NF1.format(d.rain)} mm` : '—'}</td>
        <td class="num${below ? ' warm' : ''}">${d.iso0 == null ? '—' : `${fmt.num(Math.round(d.iso0 / 50) * 50)}<br><span class="small muted">${fmt.num(Math.round(d.iso1 / 50) * 50)}</span>`}</td></tr>`;
    }).join('');
    const age = Date.now() - c.t;
    return `<table class="sched wxt"><thead><tr><th>Día</th><th class="num">°C mín/máx</th><th class="num">Viento<br>racha km/h</th><th class="num">Precip.</th><th class="num">Iso 0° m<br>mín/máx</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="small muted" style="margin:6px 0 0">Previsión para ${ele != null ? fmt.m(Math.round(ele)) : 'el punto'}${age > WX_TTL ? `, <b>guardada hace ${age > 86400000 ? Math.round(age / 86400000) + ' d' : Math.round(age / 3600000) + ' h'}</b>` : ''}. Datos: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0). Es un modelo: en alta montaña contrasta siempre con el parte oficial. <button class="link" type="button" data-act="wx-load">Actualizar</button></p>`;
  },
  /** Pinta la previsión en una caja [data-wx="lat,lon,ele"]; con `force` la pide aunque haya una guardada. */
  async load(box, force = false) {
    if (!box) return;
    const [lat, lon, eleS] = box.dataset.wx.split(','), ele = eleS === '' ? null : +eleS;
    const c = this.cached(+lat, +lon, ele);
    if (c) box.innerHTML = this.html(c, ele);
    if (c && !force && Date.now() - c.t < WX_TTL) return;
    if (!c && !force) return;
    if (navigator.onLine === false) { if (!c) box.innerHTML = '<p class="small muted" style="margin:0">Sin conexión: no hay previsión guardada de este punto.</p>'; return; }
    if (!c) box.innerHTML = '<p class="small muted" style="margin:0">Pidiendo la previsión…</p>';
    try { const data = await this.fetch(+lat, +lon, ele); if (box.isConnected) box.innerHTML = this.html({ t: Date.now(), data }, ele); }
    catch (e) { if (!c && box.isConnected) box.innerHTML = `<p class="small muted" style="margin:0">${esc(e.name === 'AbortError' ? 'La meteo tarda demasiado: poca cobertura.' : e.message || 'No se pudo cargar la meteo.')} <button class="link" type="button" data-act="wx-load">Reintentar</button></p>`; }
  },
};
/** Al abrir una ficha: enseña la previsión guardada (si la hay) sin gastar datos. */
function wxAuto() { for (const b of document.querySelectorAll('[data-wx]')) Wx.load(b, false); }

function wxBox(lat, lon, ele) {
  return `<div class="wx" data-wx="${lat.toFixed(4)},${lon.toFixed(4)},${ele != null ? Math.round(ele) : ''}"><button class="btn small" type="button" data-act="wx-load">Ver la previsión a 7 días</button></div>`;
}
/** Punto más alto del track: donde más importa la meteo. */
function routeTop(r) {
  const P = r._P;
  let k = 0;
  if (P.ele) for (let i = 1; i < P.n; i++) if (P.ele[i] > P.ele[k]) k = i;
  return { lat: P.lat[k], lon: P.lon[k], ele: P.ele ? P.ele[k] : null };
}
function wxSection(r) {
  const t = routeTop(r);
  return `<details class="sec fold" data-fold="wx"${openAttr('wx', isPlan(r))}>
    <summary><h3>Meteo <span class="muted">previsión en el punto más alto${t.ele != null ? ` (${fmt.m(Math.round(t.ele))})` : ''}</span></h3></summary>
    ${wxBox(t.lat, t.lon, t.ele)}
  </details>`;
}

/* ---------- Boletines de peligro de aludes por zona ---------- */
const AVAL_SOURCES = [
  { n: 'Lauegi · Val d\'Aran', u: 'https://lauegi.report/', b: [0.62, 42.55, 1.05, 42.87] },
  { n: 'ICGC · Pirineu de Catalunya', u: 'https://bpa.icgc.cat/', b: [0.65, 42.0, 3.2, 42.87] },
  { n: 'Meteo Andorra · estat de la neu', u: 'https://www.meteo.ad/estatneu', b: [1.4, 42.42, 1.8, 42.66] },
  { n: 'A Lurte · Pirineo aragonés', u: 'https://www.alurte.es/', b: [-1.0, 42.3, 0.8, 42.95] },
  { n: 'AEMET · boletines de aludes (Pirineos, Picos de Europa, Guadarrama, Gredos, Sierra Nevada)', u: 'https://www.aemet.es/es/eltiempo/prediccion/montana/boletin_peligro_aludes', b: [-9.5, 35.9, 3.4, 43.9] },
  { n: 'Météo-France · bulletins d\'avalanches', u: 'https://meteofrance.com/meteo-montagne', b: [-1.9, 42.3, 7.8, 46.5] },
  { n: 'SLF · boletín de aludes de Suiza', u: 'https://www.slf.ch/en/avalanche-bulletin-and-snow-situation.html', b: [5.9, 45.8, 10.5, 47.85] },
  { n: 'avalanche.report · Tirol, Tirol del Sur y Trentino', u: 'https://avalanche.report/', b: [10.0, 45.6, 13.0, 47.8] },
  { n: 'lawinen.at · Austria', u: 'https://lawinen.at/', b: [9.5, 46.3, 17.2, 49.0] },
  { n: 'EAWS · todos los servicios europeos', u: 'https://www.avalanches.org/', b: [-25, 34, 45, 72] },
  { n: 'Avalanche Canada', u: 'https://avalanche.ca/', b: [-141, 48, -110, 70] },
];
function avalLinks(lat, lon) {
  return AVAL_SOURCES.filter((s) => lon >= s.b[0] && lon <= s.b[2] && lat >= s.b[1] && lat <= s.b[3]);
}
function avalLinksHtml(p) {
  const l = avalLinks(p.lat, p.lon);
  if (!l.length) return '';
  return `<p class="small" style="margin:10px 0 0"><b>Boletín de peligro de aludes de la zona:</b> ${l.map((s) => `<a href="${s.u}" target="_blank" rel="noopener">${esc(s.n)}</a>`).join(' · ')}</p>`;
}
