'use strict';
/* ===================== 18. Terreno: pendientes y orientaciones =====================
   Dos usos del mismo modelo digital de elevaciones:

   a) Capas del mapa «Pendientes» y «Orientaciones»: cada tesela de relieve se convierte en el navegador
      en una imagen coloreada (protocolo propio `ccterr://`), así que no hace falta ningún servidor y
      las teselas de relieve guardadas para ir sin cobertura también sirven. Se pintan sobre el 3D.
      Pendientes con la convención europea de los mapas de aludes: 30-35° amarillo, 35-40° naranja,
      40-45° rojo y más de 45° violeta.

   b) Análisis de una ruta: qué parte del recorrido pisa laderas de más de 30°, en qué orientación y a
      qué altitud. Es justo lo que hay que cruzar con el boletín de peligro de aludes. */
const SLOPE_CLASSES = [[30, '#f5d400', '30-35°'], [35, '#f08c00', '35-40°'], [40, '#e0281e', '40-45°'], [45, '#8e3bb5', '> 45°']];
const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const ASPECT_COLORS = ['#2c5fd8', '#3aa0d8', '#37b36b', '#b9c832', '#f0c020', '#f08c28', '#d84a3a', '#8a4fc8'];
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Protocolo de MapLibre: ccterr://<slope|aspect>/<z>/<x>/<y> → PNG calculado a partir del relieve. */
async function terrainTile(params, abort) {
  const m = /^ccterr:\/\/(slope|aspect)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
  if (!m) throw new Error('tesela de terreno no válida');
  const mode = m[1], z = +m[2], x = +m[3], y = +m[4];
  const dem = DEMS[Net.dem === 'aws' ? 'aws' : 'mapterhorn'];
  const res = await fetch(dem.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: abort && abort.signal });
  if (!res.ok) throw new Error('relieve ' + res.status);
  const bmp = await createImageBitmap(await res.blob());
  const W = bmp.width, H = bmp.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const E = new Float32Array(W * H);
  for (let i = 0, j = 0; i < E.length; i++, j += 4) E[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
  const n = 2 ** z, sCols = SLOPE_CLASSES.map((c) => hexRgb(c[1])), aCols = ASPECT_COLORS.map(hexRgb);
  for (let py = 0; py < H; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (py + 0.5) / H)) / n))) * 180) / Math.PI;
    const px = (40075016.686 * Math.cos(toRad(lat))) / (n * W); // metros por píxel en esta fila
    const yu = Math.max(0, py - 1), yd = Math.min(H - 1, py + 1);
    for (let qx = 0; qx < W; qx++) {
      const xl = Math.max(0, qx - 1), xr = Math.min(W - 1, qx + 1);
      const ex = (E[py * W + xr] - E[py * W + xl]) / ((xr - xl) * px);   // hacia el este
      const ey = (E[yu * W + qx] - E[yd * W + qx]) / ((yd - yu) * px);   // hacia el norte
      const s = (Math.atan(Math.hypot(ex, ey)) * 180) / Math.PI;
      const j = (py * W + qx) * 4;
      let c = null;
      if (mode === 'slope') { if (s >= 30) c = sCols[s >= 45 ? 3 : s >= 40 ? 2 : s >= 35 ? 1 : 0]; }
      else if (s >= 15) c = aCols[Math.round((((Math.atan2(-ex, -ey) * 180) / Math.PI + 360) % 360) / 45) % 8];
      if (c) { d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255; } else d[j + 3] = 0;
    }
  }
  g.putImageData(img, 0, 0);
  const blob = cv.convertToBlob ? await cv.convertToBlob({ type: 'image/png' }) : await new Promise((r) => cv.toBlob(r, 'image/png'));
  return { data: await blob.arrayBuffer() };
}

function terrainLegend(mode) {
  if (mode === 'slope') return SLOPE_CLASSES.map(([, c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
  if (mode === 'aspect') return ASPECTS.map((a, i) => `<span><i style="background:${ASPECT_COLORS[i]}"></i>${a}</span>`).join('');
  return '';
}

/* ---------- Análisis de una ruta ---------- */
const TERR_BANDS = [[0, '< 25°'], [25, '25-30°'], [30, '30-35°'], [35, '35-40°'], [40, '40-45°'], [45, '> 45°']];
const TERR_COLORS = ['var(--rule-2)', '#c9d29a', '#f5d400', '#f08c00', '#e0281e', '#8e3bb5'];
const Terrain = {
  busy: false,
  /** Pendiente (°) y orientación (rumbo hacia el que mira la ladera) del terreno en un punto. */
  at(lon, lat) {
    const d = 0.0003, f = (a, b) => PlanDem.ele(a, b);
    const c = f(lon, lat);
    if (c == null) return null;
    const e1 = f(lon + d, lat), e0 = f(lon - d, lat), n1 = f(lon, lat + d), n0 = f(lon, lat - d);
    if (e1 == null || e0 == null || n1 == null || n0 == null) return null;
    const ex = (e1 - e0) / (2 * d * 111320 * Math.cos(toRad(lat))), ey = (n1 - n0) / (2 * d * 110540);
    return { s: (Math.atan(Math.hypot(ex, ey)) * 180) / Math.PI, a: ((Math.atan2(-ex, -ey) * 180) / Math.PI + 360) % 360, e: c };
  },
  async analyze(r) {
    const P = r._P, total = P.cum[P.n - 1] || 0;
    const [w, s, e, n] = r.bbox;
    await PlanDem.ensure([w - 0.003, s - 0.003, e + 0.003, n + 0.003]);
    const step = clamp(total / 3000, 20, 60);
    const cls = new Array(6).fill(0), asp = new Array(8).fill(0), segs = [];
    let lo = Infinity, hi = -Infinity, max = 0, maxAt = 0, got = 0, j = 0, open = null;
    for (let at = 0; at <= total; at += step) {
      while (j < P.n - 2 && P.cum[j + 1] < at) j++;
      const sp = P.cum[j + 1] - P.cum[j], f = sp > 0 ? clamp((at - P.cum[j]) / sp, 0, 1) : 0;
      const t = this.at(P.lon[j] + f * (P.lon[j + 1] - P.lon[j]), P.lat[j] + f * (P.lat[j + 1] - P.lat[j]));
      if (!t) { if (open) { segs.push(open); open = null; } continue; }
      got++;
      let k = 0;
      for (let b = TERR_BANDS.length - 1; b >= 0; b--) if (t.s >= TERR_BANDS[b][0]) { k = b; break; }
      cls[k] += step;
      if (t.s > max) { max = t.s; maxAt = at; }
      if (t.s >= 30) {
        asp[Math.round(t.a / 45) % 8] += step;
        if (t.e < lo) lo = t.e; if (t.e > hi) hi = t.e;
        if (open && at - open[1] <= step * 2.5) open[1] = at; else { if (open) segs.push(open); open = [at, at]; }
      }
    }
    if (open) segs.push(open);
    if (!got) throw new Error('No hay datos de relieve para esta zona.');
    return {
      v: 1, cls: cls.map(Math.round), asp: asp.map(Math.round), max: Math.round(max), maxAt: Math.round(maxAt),
      lo: isFinite(lo) ? Math.round(lo / 10) * 10 : null, hi: isFinite(hi) ? Math.round(hi / 10) * 10 : null,
      segs: segs.filter((x) => x[1] - x[0] >= step).slice(0, 80).map((x) => [Math.round(x[0]), Math.round(x[1] + step)]), when: new Date().toISOString().slice(0, 10),
    };
  },
  async run(routeId) {
    const r = S.routes.get(routeId);
    if (!r || this.busy) return;
    this.busy = true;
    const btn = document.querySelector('[data-act="terrain-run"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Leyendo el relieve…'; }
    try {
      const t = await this.analyze(r);
      (r.alp = r.alp || {}).terrain = t;
      saveRoute(r);
      (S.ui.alpOpen = S.ui.alpOpen || {}).terr = true;
    } catch (e) {
      UI.toast(navigator.onLine === false ? 'Sin conexión no puedo leer el relieve de esta zona.' : (e && e.message) || 'No se pudo leer el relieve.', { err: true });
    }
    this.busy = false;
    if (S.ui.view === 'route' && S.ui.routeId === routeId) UI.rerenderRoute();
  },
};

function aspectRose(asp) {
  const mx = Math.max(1, ...asp), R = 46, c = 60;
  let out = '';
  for (let i = 0; i < 8; i++) {
    const r = 8 + (R - 8) * Math.sqrt(asp[i] / mx), a0 = toRad(i * 45 - 22.5 - 90), a1 = toRad(i * 45 + 22.5 - 90);
    if (asp[i] > 0) out += `<path d="M${c},${c}L${(c + r * Math.cos(a0)).toFixed(1)},${(c + r * Math.sin(a0)).toFixed(1)}A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${(c + r * Math.cos(a1)).toFixed(1)},${(c + r * Math.sin(a1)).toFixed(1)}Z" fill="${ASPECT_COLORS[i]}" opacity="0.9"><title>${ASPECTS[i]}: ${fmt.num(asp[i])} m</title></path>`;
    const la = toRad(i * 45 - 90);
    out += `<text x="${(c + (R + 9) * Math.cos(la)).toFixed(1)}" y="${(c + (R + 9) * Math.sin(la) + 3.5).toFixed(1)}" text-anchor="middle">${ASPECTS[i]}</text>`;
  }
  return `<svg class="rose" width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Orientación de las laderas de más de 30 grados"><circle cx="${c}" cy="${c}" r="${R}" class="ring"/><circle cx="${c}" cy="${c}" r="${R / 2}" class="ring"/>${out}</svg>`;
}

function terrainSection(r) {
  const t = alpOf(r).terrain;
  const canRun = !!Net.dem || navigator.onLine !== false;
  let body;
  if (!t) {
    body = `<p class="small" style="margin:0 0 8px">Calcula con el modelo de elevaciones qué parte del recorrido pisa laderas de más de 30° (terreno de aludes), hacia dónde miran y a qué altitud, para cruzarlo con el boletín de peligro.</p>
      <button class="btn small" type="button" data-act="terrain-run"${canRun ? '' : ' disabled'}>Analizar el terreno</button>`;
  } else {
    const tot = t.cls.reduce((a, b) => a + b, 0) || 1, steep = t.cls[2] + t.cls[3] + t.cls[4] + t.cls[5], sc = routeScale(r);
    const order = t.asp.map((v, i) => [v, i]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]);
    const main = order.filter((x) => x[0] >= order[0][0] * 0.5).slice(0, 3).map((x) => ASPECTS[x[1]]);
    const txt = steep < 30
      ? 'El recorrido no pisa laderas de más de 30°. Ojo igualmente con las pendientes que queden por encima del camino.'
      : `<b>${fmt.km(steep * sc)}</b> del recorrido (${Math.round((steep / tot) * 100)} %) cruzan laderas de más de 30°, sobre todo en orientación <b>${listJoin(main)}</b>${t.lo != null ? ` entre <b>${fmt.num(t.lo)}</b> y <b>${fmt.num(t.hi)} m</b>` : ''}. Pendiente máxima del terreno: <b>${t.max}°</b> en el km ${fmt.kmNum(t.maxAt * sc)}.`;
    body = `<div class="terr">
        <div class="terr-bars">${TERR_BANDS.map(([, l], i) => `<div><span>${l}</span><div class="reto-bar"><i style="width:${((t.cls[i] / tot) * 100).toFixed(1)}%;background:${TERR_COLORS[i]}"></i></div><span class="num">${fmt.kmNum(t.cls[i] * sc)} km</span></div>`).join('')}</div>
        ${steep >= 30 ? aspectRose(t.asp) : ''}
      </div>
      <p class="small" style="margin:8px 0 0">${txt}</p>
      <p class="small muted" style="margin:6px 0 0">Los tramos de más de 30° van marcados en rojo bajo el perfil. Se analiza la ladera que pisas, no las que tienes encima; el relieve no ve cornisas ni resaltes pequeños. <button class="link" type="button" data-act="terrain-run">Recalcular</button></p>`;
  }
  const steepKm = t ? (t.cls[2] + t.cls[3] + t.cls[4] + t.cls[5]) * routeScale(r) : 0;
  return `<details class="sec fold" data-fold="terr"${openAttr('terr', false)}>
    <summary><h3>Terreno y aludes <span class="muted">${t ? (steepKm >= 30 ? `${fmt.km(steepKm)} por encima de 30°` : 'sin laderas de más de 30°') : 'pendientes y orientaciones'}</span></h3></summary>
    ${body}
    ${avalLinksHtml(routeCenter(r))}
  </details>`;
}
