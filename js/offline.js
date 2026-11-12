'use strict';
/* ===================== 14. Zonas sin conexión (solo en la web instalada) =====================
   Guarda en la caché del navegador las teselas del mapa del IGN y del relieve de una zona, para
   usarla en el monte sin cobertura. El trabajador de servicio (sw.js) las sirve cuando no hay red.
   OpenStreetMap no permite descargas masivas, así que solo se guardan mapas del IGN y relieve. */
const ZONES_CACHE = 'cumbres-zonas-v1';
function tileXY(lon, lat, z) {
  const n = 2 ** z, la = toRad(clamp(lat, -85, 85));
  return [clamp(Math.floor(((lon + 180) / 360) * n), 0, n - 1), clamp(Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n), 0, n - 1)];
}
const Offline = {
  available() {
    return 'caches' in window && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !!(Net.tiles['ign-topo'] || Net.tiles['ign-orto']);
  },
  zones() { try { return JSON.parse(localStorage.getItem('cc-zonas') || '[]'); } catch { return []; } },
  saveZones(z) { try { localStorage.setItem('cc-zonas', JSON.stringify(z)); } catch {} },
  urls(z) {
    const out = new Set();
    const add = (tpl, k) => {
      const [x0, y0] = tileXY(z.bbox[0], z.bbox[3], k), [x1, y1] = tileXY(z.bbox[2], z.bbox[1], k);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(tpl.replace('{z}', k).replace('{x}', x).replace('{y}', y));
    };
    for (let k = z.zmin; k <= z.zmax; k++) add(TILES[z.base].url, k);
    if (z.dem) for (let k = Math.max(8, z.zmin - 1); k <= Math.min(15, z.zmax - 1); k++) add(DEMS.mapterhorn.url, k);
    const probe = (u) => u.replace('{z}', '6').replace('{x}', '31').replace('{y}', '24');
    out.add(probe(TILES[z.base].url));
    if (z.dem) out.add(probe(DEMS.mapterhorn.url));
    return [...out];
  },
  plan(bbox) {
    const base = MapCtl.basemap === 'ign-orto' && Net.tiles['ign-orto'] ? 'ign-orto' : 'ign-topo';
    let z = null;
    for (let zmax = 16; zmax >= 12; zmax--) {
      z = { bbox, zmin: 9, zmax, base, dem: Net.dem === 'mapterhorn' };
      if (this.urls(z).length <= 3500) break;
    }
    const urls = this.urls(z);
    const mb = urls.reduce((a, u) => a + (u.includes('mapterhorn') ? 0.12 : 0.03), 0);
    return { z, n: urls.length, mb };
  },
  async download(bbox, name) {
    const { z } = this.plan(bbox);
    const urls = this.urls(z);
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
    const cache = await caches.open(ZONES_CACHE);
    let k = 0, done = 0, fail = 0;
    const worker = async () => {
      while (k < urls.length) {
        const u = urls[k++];
        try {
          if (!(await cache.match(u))) {
            const res = await fetch(u, { mode: 'cors' });
            if (res.ok) await cache.put(u, res); else fail++;
          }
        } catch { fail++; }
        done++;
        if (done % 10 === 0 || done === urls.length) UI.progress(done, urls.length, 'Guardando mapas');
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    UI.progressDone();
    const zone = { id: randomId(), name: String(name).slice(0, 80), bbox, zmin: z.zmin, zmax: z.zmax, base: z.base, dem: z.dem, n: urls.length - fail, date: new Date().toISOString() };
    this.saveZones([...this.zones(), zone]);
    return { zone, fail, total: urls.length };
  },
  async remove(id) {
    const all = this.zones(), z = all.find((x) => x.id === id);
    if (!z) return;
    // Solo se borran las teselas que no usa ninguna otra zona guardada
    const keep = new Set(all.filter((x) => x.id !== id).flatMap((x) => this.urls(x)));
    const cache = await caches.open(ZONES_CACHE);
    for (const u of this.urls(z)) if (!keep.has(u)) await cache.delete(u);
    this.saveZones(all.filter((x) => x.id !== id));
  },
};
UI.openOffline = async function () {
  const m = MapCtl.view && MapCtl.view.map;
  if (!m || !Offline.available()) { this.toast('Los mapas sin conexión solo funcionan en tu web instalada, con conexión para descargarlos.', { err: true }); return; }
  const b = m.getBounds ? m.getBounds() : null;
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  const plan = Offline.plan(bbox);
  this._offBBox = bbox;
  $('#offPlan').textContent = `${TILES[plan.z.base] === TILES['ign-orto'] ? 'Ortofoto' : 'Mapa topográfico'} del IGN${plan.z.dem ? ' y relieve 3D' : ''}, del zoom ${plan.z.zmin} al ${plan.z.zmax}: unas ${fmt.num(plan.n)} teselas, cerca de ${fmt.num(Math.max(1, plan.mb))} MB.`;
  await this.paintZones();
  $('#dlgOffline').showModal();
};
UI.paintZones = async function () {
  const zs = Offline.zones();
  $('#offList').innerHTML = zs.length ? zs.map((z) => `<li><div><b>${esc(z.name)}</b><div class="small muted">${fmt.date(z.date)}, ${fmt.num(z.n)} teselas, zoom ${z.zmin}-${z.zmax}${z.dem ? ', con relieve' : ''}</div></div>
    <div class="row"><button class="btn small" type="button" data-zone="see" data-id="${z.id}">Ver</button><button class="btn small danger" type="button" data-zone="del" data-id="${z.id}">Borrar</button></div></li>`).join('') : '<li class="small muted">Todavía no has guardado ninguna zona.</li>';
  try { const e = await navigator.storage.estimate(); $('#offUsage').textContent = `Espacio usado por la app: ${fmt.num(e.usage / 1048576)} MB.`; } catch { $('#offUsage').textContent = ''; }
};
UI.saveZone = async function (bbox, name) {
  const dlg = $('#dlgOffline');
  if (dlg.open) dlg.close();
  this.toast('Guardando los mapas de la zona. Puedes seguir usando la app mientras tanto.');
  try {
    const r = await Offline.download(bbox, name);
    this.toast(r.fail ? `Zona guardada, aunque ${r.fail} de ${r.total} teselas no se pudieron descargar.` : `Zona guardada para usarla sin cobertura: ${name}.`, { err: !!r.fail, timeout: 8000 });
  } catch (e) { UI.progressDone(); this.toast('No se pudo guardar la zona: ' + ((e && e.message) || e), { err: true }); }
};
