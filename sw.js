/* Cuaderno de cumbres: la app abre sin conexión y guarda los mapas y el relieve que ya has visto. */
const APP = 'cumbres-app-v1';
const TILES = 'cumbres-teselas-v1';
const MAX_TILES = 4000;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
const isTile = (u) => /tile\.openstreetmap\.org|ign\.es\/wmts|elevation-tiles-prod/.test(u);
const isLib = (u) => /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(u);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (isTile(url)) e.respondWith(tile(req));
  else if (isLib(url)) e.respondWith(cacheFirst(req));
  else if (new URL(url).origin === self.location.origin) e.respondWith(networkFirst(req));
});
async function cacheFirst(req) {
  const c = await caches.open(APP);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  const c = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
let trimming = false;
async function tile(req) {
  const c = await caches.open(TILES);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await c.put(req, res.clone());
    if (!trimming) {
      trimming = true;
      c.keys().then(async (keys) => {
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await c.delete(k);
      }).finally(() => { trimming = false; });
    }
  }
  return res;
}
