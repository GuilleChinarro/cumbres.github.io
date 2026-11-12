'use strict';
/* ===================== 10. Arranque ===================== */
/** Fuera de Claude (alojada en https): manifiesto e instalación como app, con caché sin conexión. */
function setupPWA() {
  if (!/^https?:$/.test(location.protocol)) return;
  const add = (tag, attrs) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); document.head.appendChild(el); };
  add('link', { rel: 'manifest', href: 'manifest.webmanifest' });
  add('link', { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' });
  add('meta', { name: 'theme-color', content: '#1e2622' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Cumbres' });
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
async function boot() {
  setupPWA();
  UI.init();
  const refP = Ref.load();
  const storeP = initStore();
  MapCtl.init(refP);
  try { await refP; }
  catch (e) { UI.fatal('No se pudieron preparar los datos de cumbres: ' + (e.message || e)); return; }
  S.store = await storeP;
  try {
    const { state, routes } = await S.store.loadAll();
    S.data = mergeData(state);
    for (const raw of routes) {
      try { const r = clone(raw); hydrateRoute(r); S.routes.set(r.id, r); }
      catch (e) { console.warn('Ruta ilegible', raw && raw.id, e); }
    }
  } catch (e) {
    UI.toast('No se pudieron leer tus datos guardados: ' + (e.message || e), { err: true, timeout: 9000 });
  }
  S.loaded = true;
  UI.syncChanged();
  UI.render();
  if (await MapCtl.whenReady()) { MapCtl.syncAll(); MapCtl.fitVisible(false); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
