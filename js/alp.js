'use strict';
/* ===================== 17. Cuaderno de alpinismo =====================
   Todo lo que una ruta lleva además del track: vía y graduaciones, cordada, material, condiciones,
   resultado (cumbre o retirada), puntos marcados (retirada, pasos clave, vivac…) y el horario.
   Se guarda dentro de la propia ruta, en `route.alp`, y viaja con ella al exportar e importar.

     route.status = 'plan'            proyecto (aún sin hacer): no cuenta cumbres ni estadísticas
     route.alp = {
       via, notes, outcome, reason, role,
       grades: { alp, rock, ice, mixed, snow, ski, ferr, eng },
       team: [nombre…], gear: [id…], gearNote,
       cond: { snow, ice, snowline, aval, sky, wind, temp, note },
       wps: [{ at (m desde la salida), kind, name }],
       plan: { start 'HH:MM', pace, turn 'HH:MM', rest (min) },
       terrain: { … }                 resumen del análisis de pendientes (ver terrain.js)
     } */
const seq = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => p + (a + i));
const ALP_GRADES = [
  ['alp', 'Dificultad alpina', ['F', 'F+', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+', 'TD-', 'TD', 'TD+', 'ED-', 'ED', 'ED+', 'ABO']],
  ['eng', 'Compromiso', ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']],
  ['rock', 'Roca', ['I', 'II', 'II+', 'III', 'III+', 'IV', 'IV+', 'V', 'V+', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '8a']],
  ['snow', 'Nieve (pendiente máx.)', ['30°', '35°', '40°', '45°', '50°', '55°', '60°', '65°', '70°', '75°', '80°', '90°']],
  ['ice', 'Hielo', seq('WI', 1, 7)],
  ['mixed', 'Mixto', seq('M', 1, 10)],
  ['ski', 'Esquí (descenso)', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']],
  ['ferr', 'Vía ferrata', seq('K', 1, 6)],
];
const ALP_GEAR = [
  ['crampones', 'Crampones'], ['piolet', 'Piolet'], ['piolets', 'Piolets técnicos'], ['casco', 'Casco'], ['arnes', 'Arnés'],
  ['cuerda', 'Cuerda'], ['dobles', 'Cuerdas dobles'], ['tornillos', 'Tornillos de hielo'], ['friends', 'Friends'], ['fisureros', 'Fisureros'],
  ['cintas', 'Cintas y exprés'], ['estacas', 'Estacas de nieve'], ['dva', 'DVA, pala y sonda'], ['raquetas', 'Raquetas'], ['esquis', 'Esquís y pieles'],
  ['cuchillas', 'Cuchillas'], ['disipador', 'Disipador de ferrata'], ['vivac', 'Saco o funda de vivac'], ['tienda', 'Tienda'], ['hornillo', 'Hornillo'],
  ['frontal', 'Frontal'], ['satelite', 'Mensajero satelital'], ['botiquin', 'Botiquín'], ['ventisca', 'Gafas de ventisca'],
];
const ALP_SNOW = ['Sin nieve', 'Polvo', 'Polvo venteada', 'Costra', 'Dura o helada', 'Primavera (transformada)', 'Húmeda y pesada', 'Placas de viento', 'Neveros aislados'];
const ALP_ICE = ['Sin hielo', 'Verglás', 'Hielo bien formado', 'Hielo fino o mal formado', 'Hielo negro', 'Glaciar tapado', 'Glaciar abierto (grietas)'];
const ALP_SKY = ['Despejado', 'Nubes y claros', 'Cubierto', 'Niebla', 'Lluvia', 'Nevada', 'Tormenta'];
const ALP_WIND = ['Calma', 'Flojo', 'Moderado', 'Fuerte', 'Muy fuerte'];
const ALP_AVAL = [['1', '1 · Débil'], ['2', '2 · Limitado'], ['3', '3 · Notable'], ['4', '4 · Fuerte'], ['5', '5 · Muy fuerte']];
const ALP_OUTCOME = [['cumbre', 'Cumbre'], ['parcial', 'Objetivo parcial'], ['retirada', 'Retirada']];
const ALP_REASON = ['Meteo', 'Condiciones de nieve o hielo', 'Riesgo de aludes', 'Horario', 'Cansancio', 'Material', 'Lesión o indisposición', 'Dificultad', 'Otra'];
const ALP_ROLE = [['', '—'], ['solo', 'En solitario'], ['primero', 'De primero'], ['alternos', 'Largos alternos'], ['segundo', 'De segundo'], ['guiado', 'Con guía'], ['grupo', 'En grupo sin encordar']];
const WP_KINDS = [['retirada', 'Punto de retirada'], ['limite', 'Punto de decisión'], ['paso', 'Paso clave'], ['rapel', 'Rápel o destrepe'], ['rimaya', 'Rimaya o grietas'], ['vivac', 'Vivac'], ['refugio', 'Refugio'], ['agua', 'Agua'], ['peligro', 'Peligro'], ['otro', 'Otro']];
const WP_LABEL = Object.fromEntries(WP_KINDS);
const ALP_PACES = [['tranquilo', 'Tranquilo', 1.25], ['normal', 'Normal', 1], ['rapido', 'Rápido', 0.8]];

const isPlan = (r) => !!r && r.status === 'plan';
const alpOf = (r) => (r && r.alp) || {};
const hasAlp = (r) => { const a = alpOf(r); return !!(a.via || a.notes || a.outcome || (a.team && a.team.length) || (a.gear && a.gear.length) || Object.keys(a.grades || {}).length || Object.keys(a.cond || {}).length); };

/** Limpia lo que llega de fuera (importación) para que `alp` tenga siempre la forma esperada. */
function sanitizeAlp(a) {
  if (!a || typeof a !== 'object') return null;
  const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');
  const out = {};
  for (const k of ['via', 'outcome', 'reason', 'role', 'gearNote']) if (a[k]) out[k] = str(a[k]);
  if (a.notes) out.notes = str(a.notes, 8000);
  for (const g of ['grades', 'cond', 'plan']) {
    if (a[g] && typeof a[g] === 'object') { out[g] = {}; for (const [k, v] of Object.entries(a[g])) if (v !== '' && v != null && typeof v !== 'object') out[g][String(k).slice(0, 20)] = typeof v === 'number' ? v : str(String(v), 600); }
  }
  for (const k of ['team', 'gear']) if (Array.isArray(a[k])) out[k] = a[k].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 40);
  if (Array.isArray(a.wps)) out.wps = a.wps.filter((w) => w && isFinite(w.at)).map((w) => ({ at: Math.max(0, Math.round(+w.at)), kind: WP_LABEL[w.kind] ? w.kind : 'otro', name: str(w.name, 80) })).slice(0, 60);
  if (a.terrain && typeof a.terrain === 'object') { try { out.terrain = JSON.parse(JSON.stringify(a.terrain)); } catch {} }
  return Object.keys(out).length ? out : null;
}

/* ---------- Acciones ---------- */
Actions.setAlp = function (routeId, path, value) {
  const r = S.routes.get(routeId);
  if (!r) return;
  const a = (r.alp = r.alp || {});
  const [k, sub] = path.split('.');
  let v = typeof value === 'string' ? value.trim() : value;
  if (k === 'status') { if (v === 'plan') r.status = 'plan'; else delete r.status; invalidate(); saveRoute(r); return; }
  if (k === 'team') v = String(v).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
  if (sub) {
    const o = (a[k] = a[k] || {});
    if (['snowline', 'temp', 'rest'].includes(sub) && v !== '') v = Math.round(+String(v).replace(',', '.')) || 0;
    if (v === '' || v == null) delete o[sub]; else o[sub] = v;
    if (!Object.keys(o).length) delete a[k];
  } else if (v === '' || v == null || (Array.isArray(v) && !v.length)) delete a[k];
  else a[k] = v;
  if (!Object.keys(a).length) delete r.alp;
  invalidate(); saveRoute(r);
};
Actions.toggleGear = function (routeId, id) {
  const r = S.routes.get(routeId);
  if (!r) return false;
  const a = (r.alp = r.alp || {});
  const g = new Set(a.gear || []);
  const on = !g.has(id);
  if (on) g.add(id); else g.delete(id);
  a.gear = [...g];
  if (!a.gear.length) delete a.gear;
  saveRoute(r);
  return on;
};
Actions.addWp = function (routeId, at, kind, name) {
  const r = S.routes.get(routeId);
  if (!r) return;
  const a = (r.alp = r.alp || {});
  a.wps = [...(a.wps || []), { at: Math.round(at), kind: WP_LABEL[kind] ? kind : 'otro', name: String(name || '').trim().slice(0, 80) }].sort((x, y) => x.at - y.at);
  saveRoute(r);
};
Actions.removeWp = function (routeId, i) {
  const r = S.routes.get(routeId);
  if (!r || !r.alp || !r.alp.wps) return;
  r.alp.wps.splice(i, 1);
  if (!r.alp.wps.length) delete r.alp.wps;
  saveRoute(r);
};

/** Compañeros que ya aparecen en el cuaderno, de más a menos habituales. */
function knownPartners() {
  const c = new Map();
  for (const r of S.routes.values()) for (const n of alpOf(r).team || []) c.set(n, (c.get(n) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
}
/** Resumen de graduación en una línea: «PD+ · III · 45° · WI3». */
function gradeLine(r) {
  const g = alpOf(r).grades || {};
  return ALP_GRADES.map(([k]) => g[k]).filter(Boolean).join(' · ');
}

/* ---------- Sol: orto y ocaso (ecuación del amanecer; sin red) ---------- */
function sunTimes(dateMs, lat, lon) {
  const rad = Math.PI / 180, d = new Date(dateMs);
  const jd = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12) / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0), js = n - lon / 360;
  const M = (357.5291 + 0.98560028 * js) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const jt = 2451545.0 + js + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const sd = Math.sin(L * rad) * Math.sin(23.4397 * rad), cd = Math.cos(Math.asin(sd));
  const ch = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sd) / (Math.cos(lat * rad) * cd);
  if (ch < -1 || ch > 1) return null;
  const w = Math.acos(ch) / rad / 360;
  const ms = (j) => (j - 2440587.5) * 86400000;
  return { rise: ms(jt - w), set: ms(jt + w) };
}
const hhmm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const minOf = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };
const minTxt = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const durTxt = (min) => { min = Math.round(min); return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`; };

/* ---------- Horario: método de Munter sobre el perfil del track ----------
   Tiempo (h) = (km + desnivel/100) / ritmo; ritmo 4 subiendo o llaneando y 6 bajando a pie
   (10 bajando con esquís). Es el cálculo que se enseña en los cursos de alpinismo y esquí de montaña. */
function munterTable(r) {
  const P = r._P, total = P.cum[P.n - 1] || 0, scale = routeScale(r);
  const ski = r.type === 'esqui';
  const step = Math.max(40, total / 1500);
  const D = [0], Mn = [0];
  let prevE = P.ele ? eleAt(P, 0) : 0, acc = 0, top = { at: 0, e: prevE };
  // altitud suavizada: media de la ventana para no sumar el ruido del GPS como desnivel
  const eSm = (at) => { if (!P.ele) return 0; let s = 0; for (let k = -2; k <= 2; k++) s += eleAt(P, clamp(at + k * step * 0.5, 0, total)); return s / 5; };
  prevE = eSm(0);
  for (let at = step; at < total + step; at += step) {
    const a = Math.min(at, total), e = eSm(a), dz = e - prevE, dkm = ((a - D[D.length - 1]) * scale) / 1000;
    const rate = dz < -0.02 * (a - D[D.length - 1]) ? (ski ? 10 : 6) : 4;
    acc += ((dkm + Math.abs(dz) / 100) / rate) * 60;
    D.push(a); Mn.push(acc); prevE = e;
    const raw = P.ele ? eleAt(P, a) : 0;
    if (raw > top.e) top = { at: a, e: raw };
    if (a >= total) break;
  }
  const at2min = (at) => { let lo = 0, hi = D.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] <= at) lo = m; else hi = m; } const sp = D[hi] - D[lo]; return Mn[lo] + (sp > 0 ? clamp((at - D[lo]) / sp, 0, 1) : 0) * (Mn[hi] - Mn[lo]); };
  return { total, top, at2min, munter: acc };
}
/** Filas del horario: salida, cumbres, puntos marcados, punto más alto y llegada, con hora prevista y real. */
function scheduleOf(r) {
  const P = r._P, T = munterTable(r), a = alpOf(r), pl = a.plan || {};
  const pace = (ALP_PACES.find((p) => p[0] === pl.pace) || ALP_PACES[1])[2];
  const rest = +pl.rest || 0;
  const realStart = P.t ? P.t[0] * 1000 : null;
  const startMin = minOf(pl.start) ?? (realStart != null && !isPlan(r) ? new Date(realStart).getHours() * 60 + new Date(realStart).getMinutes() : 7 * 60);
  const rows = [{ at: 0, kind: 'start', name: 'Salida' }];
  for (const pe of r.peaks) { const st = statusOf(r, pe); if (st === 'climbed' || (isPlan(r) && st === 'near' && pe.d <= 150)) rows.push({ at: pe.at, kind: 'peak', name: peakName(pe) }); }
  (a.wps || []).forEach((w, i) => rows.push({ at: w.at, kind: w.kind, name: w.name || WP_LABEL[w.kind], wp: i }));
  if (P.ele && !rows.some((x) => x.kind === 'peak' && Math.abs(x.at - T.top.at) < 250)) rows.push({ at: T.top.at, kind: 'top', name: 'Punto más alto' });
  rows.push({ at: T.total, kind: 'end', name: 'Llegada' });
  rows.sort((x, y) => x.at - y.at || (x.kind === 'start' ? -1 : 0));
  const topMin = T.at2min(T.top.at) * pace;
  for (const x of rows) {
    const m = T.at2min(x.at) * pace + (x.at > T.top.at ? rest : 0);
    x.min = m; x.eta = startMin + m; x.ele = P.ele ? eleAt(P, x.at) : null;
    if (P.t) { const i = idxAt(P, x.at); x.real = P.t[i] * 1000; }
  }
  const turn = minOf(pl.turn);
  const date = r.date ? Date.parse(r.date) : Date.now();
  const sun = sunTimes(date, P.lat[0], P.lon[0]);
  const realMoving = r.stats && r.stats.moving ? r.stats.moving / 60 : null;
  return { rows, T, pace, rest, startMin, turn, sun, topEta: startMin + topMin, endEta: startMin + T.munter * pace + rest, ratio: realMoving && T.munter ? realMoving / T.munter : null };
}

/* ---------- Vistas (secciones de la ficha de ruta) ---------- */
const optList = (opts, cur, empty = '—') => `<option value="">${empty}</option>` + opts.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(cur ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
const alpSel = (label, path, opts, cur) => `<label class="field"><span>${label}</span><select data-alp="${path}">${optList(opts, cur)}</select></label>`;
const openAttr = (k, def = false) => ((S.ui.alpOpen || {})[k] ?? def ? ' open' : '');

function alpSections(r) {
  const a = alpOf(r), g = a.grades || {}, c = a.cond || {};
  const gear = new Set(a.gear || []);
  const partners = knownPartners();
  const gl = gradeLine(r);
  return `
  <details class="sec fold" data-fold="asc"${openAttr('asc', hasAlp(r) || /alpin|escal|esqui/.test(r.type))}>
    <summary><h3>Ascensión ${gl ? `<span class="grade">${esc(gl)}</span>` : '<span class="muted">vía, dificultad y resultado</span>'}</h3></summary>
    <div class="grid2">
      <label class="field full"><span>Vía o itinerario</span><input type="text" data-alp="via" value="${esc(a.via || '')}" placeholder="Corredor norte, arista este, vía normal…" maxlength="200"></label>
      ${alpSel('Estado', 'status', [['plan', 'Proyecto (por hacer)']], isPlan(r) ? 'plan' : '').replace('<option value="">—</option>', '<option value="">Realizada</option>')}
      ${alpSel('Resultado', 'outcome', ALP_OUTCOME, a.outcome)}
      ${a.outcome === 'retirada' || a.outcome === 'parcial' ? alpSel('Motivo', 'reason', ALP_REASON, a.reason) : ''}
      ${ALP_GRADES.map(([k, l, o]) => alpSel(l, 'grades.' + k, o, g[k])).join('')}
    </div>
    <label class="field" style="margin-top:8px"><span>Notas de la ascensión</span><textarea data-alp="notes" rows="4" placeholder="Aproximación, pasos clave, reuniones, descenso, lo que harías distinto…">${esc(a.notes || '')}</textarea></label>
  </details>
  <details class="sec fold" data-fold="team"${openAttr('team', !!(a.team && a.team.length))}>
    <summary><h3>Cordada ${a.team && a.team.length ? `<span class="muted">${esc(listJoin(a.team))}</span>` : '<span class="muted">con quién fuiste</span>'}</h3></summary>
    <div class="grid2">
      <label class="field"><span>Compañeros (separados por comas)</span><input type="text" data-alp="team" list="dlPartners" value="${esc((a.team || []).join(', '))}" placeholder="Ana, Luis" autocomplete="off"></label>
      ${alpSel('Cómo fuiste', 'role', ALP_ROLE.slice(1), a.role)}
    </div>
    <datalist id="dlPartners">${partners.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
    ${partners.length ? `<p class="small muted" style="margin:6px 0 0">Habituales: ${partners.slice(0, 8).map(([n, k]) => `<button class="link" type="button" data-act="alp-partner" data-id="${esc(n)}">${esc(n)}</button> (${k})`).join(', ')}</p>` : ''}
  </details>
  <details class="sec fold" data-fold="gear"${openAttr('gear', gear.size > 0)}>
    <summary><h3>Material <span class="muted">${gear.size ? `${gear.size} ${gear.size === 1 ? 'elemento' : 'elementos'}` : 'qué llevaste o hace falta'}</span></h3></summary>
    <div class="chips">${ALP_GEAR.map(([k, l]) => `<button class="chip tog" type="button" data-act="alp-gear" data-id="${k}" aria-pressed="${gear.has(k)}">${l}</button>`).join('')}</div>
    <label class="field" style="margin-top:8px"><span>Otros y detalles (metros de cuerda, número de tornillos…)</span><input type="text" data-alp="gearNote" value="${esc(a.gearNote || '')}" maxlength="200"></label>
  </details>
  <details class="sec fold" data-fold="cond"${openAttr('cond', Object.keys(c).length > 0)}>
    <summary><h3>Condiciones <span class="muted">${[c.snow, c.ice, c.aval ? 'aludes ' + c.aval : '', c.sky].filter(Boolean).map(esc).join(' · ') || 'nieve, hielo, aludes y meteo del día'}</span></h3></summary>
    <div class="grid2">
      ${alpSel('Nieve', 'cond.snow', ALP_SNOW, c.snow)}
      ${alpSel('Hielo y glaciar', 'cond.ice', ALP_ICE, c.ice)}
      <label class="field"><span>Cota de nieve (m)</span><input type="number" data-alp="cond.snowline" value="${c.snowline ?? ''}" min="0" max="9000" step="50" inputmode="numeric"></label>
      ${alpSel('Peligro de aludes del boletín', 'cond.aval', ALP_AVAL, c.aval)}
      ${alpSel('Cielo', 'cond.sky', ALP_SKY, c.sky)}
      ${alpSel('Viento', 'cond.wind', ALP_WIND, c.wind)}
      <label class="field"><span>Temperatura en cumbre (°C)</span><input type="number" data-alp="cond.temp" value="${c.temp ?? ''}" min="-60" max="45" step="1" inputmode="numeric"></label>
    </div>
    <label class="field" style="margin-top:8px"><span>Observaciones (rimaya, cornisas, purgas, estado del corredor…)</span><textarea data-alp="cond.note" rows="2">${esc(c.note || '')}</textarea></label>
  </details>`;
}

function scheduleSection(r) {
  const s = scheduleOf(r), a = alpOf(r), pl = a.plan || {};
  const sc = routeScale(r), plan = isPlan(r);
  const late = (x) => s.turn != null && x.at <= s.T.top.at + 1 && x.kind !== 'start' && x.eta > s.turn;
  const rows = s.rows.map((x) => `<tr class="${x.kind}${late(x) ? ' late' : ''}">
      <td>${x.kind === 'peak' ? VTX('climbed', 12) + ' ' : ''}${esc(x.name)}${x.wp != null ? ` <button class="link x" type="button" data-act="wp-del" data-id="${x.wp}" aria-label="Quitar punto">✕</button>` : ''}${x.wp != null && x.name !== WP_LABEL[x.kind] ? `<br><span class="small muted">${esc(WP_LABEL[x.kind])}</span>` : ''}</td>
      <td class="num">${fmt.kmNum(x.at * sc)}</td><td class="num">${x.ele != null ? fmt.num(Math.round(x.ele)) : ''}</td>
      <td class="num">${minTxt(x.eta)}</td>${!plan && r._P.t ? `<td class="num">${x.real ? hhmm(x.real) : ''}</td>` : ''}</tr>`).join('');
  const msgs = [];
  if (s.turn != null) {
    const d = s.topEta - s.turn;
    msgs.push(d > 0 ? `<b class="warn">Llegarías al punto más alto a las ${minTxt(s.topEta)}, ${durTxt(d)} después de tu hora límite (${minTxt(s.turn)}).</b> Sal antes, acorta el objetivo o decide ya dónde te das la vuelta.`
      : `Llegas al punto más alto a las ${minTxt(s.topEta)}, con ${durTxt(-d)} de margen sobre la hora límite (${minTxt(s.turn)}).`);
  }
  if (s.sun) {
    const rise = new Date(s.sun.rise), set = new Date(s.sun.set);
    const rm = rise.getHours() * 60 + rise.getMinutes(), sm = set.getHours() * 60 + set.getMinutes();
    let t = `Sol: sale a las ${hhmm(s.sun.rise)} y se pone a las ${hhmm(s.sun.set)}${r.date ? '' : ' (hoy)'}.`;
    if (s.startMin < rm) t += ` Empiezas ${durTxt(rm - s.startMin)} antes de amanecer: frontal.`;
    if (s.endEta > sm) t += ` <b class="warn">Acabarías ${durTxt(s.endEta - sm)} después de anochecer.</b>`;
    else t += ` Acabas ${durTxt(sm - s.endEta)} antes de anochecer.`;
    msgs.push(t);
  }
  if (!plan && s.ratio) msgs.push(`Tu tiempo en movimiento fue <b>${NF1.format(s.ratio)}×</b> el teórico de Munter (${durTxt(s.T.munter)}). ${s.ratio < 0.9 ? 'Vas más rápido que el cálculo estándar: puedes planificar con ritmo «Rápido».' : s.ratio > 1.15 ? 'Para planificar rutas parecidas, usa el ritmo «Tranquilo».' : 'El ritmo «Normal» te representa bien.'}`);
  const at = S.ui.profAt;
  return `<details class="sec fold" data-fold="sched"${openAttr('sched', plan || !!(a.wps && a.wps.length) || !!pl.turn)}>
    <summary><h3>Horario y puntos de retirada <span class="muted">${durTxt(s.T.munter * s.pace + s.rest)} previstas</span></h3></summary>
    <div class="grid2 four">
      <label class="field"><span>Salida</span><input type="time" data-alp="plan.start" value="${esc(pl.start || minTxt(s.startMin))}"></label>
      ${alpSel('Ritmo', 'plan.pace', ALP_PACES.map(([k, l]) => [k, l]), pl.pace || 'normal').replace('<option value="">—</option>', '')}
      <label class="field"><span>Paradas (min)</span><input type="number" data-alp="plan.rest" value="${pl.rest ?? ''}" min="0" max="600" step="5" placeholder="0" inputmode="numeric"></label>
      <label class="field"><span>Hora límite en cumbre</span><input type="time" data-alp="plan.turn" value="${esc(pl.turn || '')}"></label>
    </div>
    <table class="sched"><thead><tr><th>Punto</th><th class="num">km</th><th class="num">m</th><th class="num">Previsto</th>${!plan && r._P.t ? '<th class="num">Real</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    ${msgs.map((m) => `<p class="small" style="margin:8px 0 0">${m}</p>`).join('')}
    <div class="wpadd">
      <p class="small muted" style="margin:10px 0 6px">Para marcar un punto de retirada, un paso clave o un vivac, toca primero el perfil en el sitio exacto.</p>
      <div class="row">
        <select id="wpKind" aria-label="Tipo de punto">${WP_KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <input type="text" id="wpName" placeholder="Nombre (opcional)" maxlength="80" aria-label="Nombre del punto">
        <button class="btn small" type="button" data-act="wp-add" id="wpBtn"${at == null ? ' disabled' : ''}>${at == null ? 'Toca el perfil' : `Marcar en km ${fmt.kmNum(at * sc)}`}</button>
      </div>
    </div>
    <p class="small muted" style="margin:10px 0 0">Tiempos por el método de Munter: (km + desnivel/100) entre 4 al subir y 6 al bajar${r.type === 'esqui' ? ' (10 con esquís)' : ''}. Son tiempos de marcha: el terreno técnico, encordarse o abrir huella los alargan.</p>
  </details>`;
}

/* ---------- Estadísticas: pestaña «Resumen» ---------- */
function statsView() {
  const done = [...S.routes.values()].filter((r) => !isPlan(r));
  if (!done.length) return `<div class="empty"><p>Cuando añadas rutas verás aquí tus totales por año, tus récords y con quién has salido más.</p></div>`;
  const years = new Map(), types = new Map(), team = new Map(), months = new Array(12).fill(0);
  const seen = new Set();
  let tot = { n: 0, dist: 0, gain: 0, time: 0 };
  const best = { ele: null, gain: null, dist: null, dur: null };
  const top = (k, r, v) => { if (v != null && (!best[k] || v > best[k].v)) best[k] = { r, v }; };
  for (const r of [...done].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const st = r.stats || {}, y = fmt.year(r.date) || 'Sin fecha';
    const Y = years.get(y) || { n: 0, dist: 0, gain: 0, time: 0, peaks: 0, fresh: 0, max: 0 };
    Y.n++; Y.dist += st.dist || 0; Y.gain += st.gain || 0; Y.time += st.moving || st.duration || 0; Y.max = Math.max(Y.max, st.maxEle || 0);
    for (const pe of r.peaks) if (statusOf(r, pe) === 'climbed') { Y.peaks++; if (!seen.has(pe.id)) { seen.add(pe.id); Y.fresh++; } }
    years.set(y, Y);
    tot.n++; tot.dist += st.dist || 0; tot.gain += st.gain || 0; tot.time += st.moving || st.duration || 0;
    types.set(r.type, (types.get(r.type) || 0) + 1);
    for (const n of alpOf(r).team || []) team.set(n, (team.get(n) || 0) + 1);
    if (r.date) months[new Date(r.date).getMonth()] += st.gain || 0;
    top('ele', r, st.maxEle); top('gain', r, st.gain); top('dist', r, st.dist); top('dur', r, st.duration);
  }
  const ys = [...years.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const maxG = Math.max(1, ...ys.map(([, y]) => y.gain)), maxM = Math.max(1, ...months);
  const M = mountains();
  let highest = null, n3 = 0, n2 = 0;
  for (const m of M.values()) if (m.climbs.length) { const e = m.info.ele || 0; if (!highest || e > (highest.info.ele || 0)) highest = m; if (e >= 3000) n3++; else if (e >= 2000) n2++; }
  const grades = new Map();
  for (const r of done) { const g = (alpOf(r).grades || {}).alp; if (g) grades.set(g, (grades.get(g) || 0) + 1); }
  const order = ALP_GRADES[0][2];
  const rec = (label, b, f) => (b ? `<li><span class="k">${label}</span><button class="link plain" type="button" data-act="open-route" data-id="${esc(b.r.id)}"><b>${f(b.v)}</b> · ${esc(b.r.name)}</button></li>` : '');
  const retreats = done.filter((r) => alpOf(r).outcome === 'retirada').length;
  return `<div class="detail statsv">
    <div class="stats">
      <div class="stat"><span class="k">Salidas</span><span class="v">${fmt.num(tot.n)}</span></div>
      <div class="stat"><span class="k">Cumbres distintas</span><span class="v">${fmt.num(seen.size)}</span></div>
      <div class="stat"><span class="k">Distancia</span><span class="v">${fmt.km(tot.dist)}</span></div>
      <div class="stat"><span class="k">Desnivel positivo</span><span class="v">${fmt.m(tot.gain)}</span></div>
      <div class="stat"><span class="k">Tiempo en marcha</span><span class="v">${Math.round(tot.time / 3600)} h</span></div>
      <div class="stat"><span class="k">Techo</span><span class="v cota">${highest ? fmt.m(highest.info.ele) : '—'}</span></div>
    </div>
    <div class="sec"><h3>Por año</h3>
      <table class="sched"><thead><tr><th>Año</th><th class="num">Salidas</th><th class="num">km</th><th class="num">Desnivel</th><th class="num">Cumbres</th><th class="num">Nuevas</th></tr></thead>
      <tbody>${ys.map(([y, v]) => `<tr><td><button class="link plain" type="button" data-act="stats-year" data-id="${esc(y === 'Sin fecha' ? 'sin' : y)}"><b>${esc(y)}</b></button><div class="reto-bar"><i style="width:${Math.round((v.gain / maxG) * 100)}%"></i></div></td><td class="num">${v.n}</td><td class="num">${fmt.kmNum(v.dist)}</td><td class="num">${fmt.num(v.gain)}</td><td class="num">${v.peaks}</td><td class="num">${v.fresh}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="sec"><h3>Desnivel por mes <span class="muted">todos los años</span></h3>
      <div class="months">${months.map((g, i) => `<div title="${fmt.num(g)} m"><i style="height:${Math.round((g / maxM) * 100)}%"></i><span>${'EFMAMJJASOND'[i]}</span></div>`).join('')}</div>
    </div>
    <div class="sec"><h3>Récords</h3><ul class="recs">
      ${rec('Más alto', best.ele, (v) => fmt.m(v))}${rec('Más desnivel', best.gain, (v) => fmt.m(v))}${rec('Más larga', best.dist, (v) => fmt.km(v))}${rec('Más horas', best.dur, (v) => fmt.dur(v))}
      ${highest ? `<li><span class="k">Cumbre más alta</span><button class="link plain" type="button" data-act="open-peak" data-id="${esc(highest.id)}"><b>${esc(highest.info.name)}</b> · ${fmt.m(highest.info.ele)}</button></li>` : ''}
      <li><span class="k">Tresmiles y dosmiles</span><span><b>${n3}</b> de más de 3.000 m · <b>${n2}</b> entre 2.000 y 3.000 m</span></li>
    </ul></div>
    <div class="sec"><h3>Actividades</h3><div class="chips">${[...types.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip">${esc(TYPE_LABEL[t] || t)} · ${n}</span>`).join('')}</div>
      ${grades.size ? `<p class="small" style="margin:10px 0 0">Dificultad alpina: ${[...grades.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([g, n]) => `<span class="grade">${esc(g)}</span> ×${n}`).join(' &nbsp; ')}</p>` : ''}
      ${retreats ? `<p class="small muted" style="margin:8px 0 0">${retreats === 1 ? 'Una retirada apuntada' : `${retreats} retiradas apuntadas`}: darse la vuelta a tiempo también cuenta.</p>` : ''}
    </div>
    ${team.size ? `<div class="sec"><h3>Cordada</h3><ul class="recs">${[...team.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, k]) => `<li><span class="k">${esc(n)}</span><span><b>${k}</b> ${k === 1 ? 'salida' : 'salidas'}</span></li>`).join('')}</ul></div>` : ''}
  </div>`;
}
