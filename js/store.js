'use strict';
/* ===================== 6. Almacenamiento ===================== */
const ROUTE_FIELDS = ['id', 'v', 'name', 'date', 'type', 'source', 'fp', 'stats', 'bbox', 'trk', 'peaks', 'decisions', 'created', 'updated', 'status', 'alp'];
function serializeRoute(r) {
  const o = {};
  for (const k of ROUTE_FIELDS) if (r[k] !== undefined) o[k] = r[k];
  return clone(o);
}

class MemoryStore {
  constructor() { this.mode = 'memory'; this.state = null; this.routes = new Map(); }
  async loadAll() { return { state: this.state, routes: [...this.routes.values()] }; }
  async saveState(s) { this.state = clone(s); }
  async saveRoute(r) { this.routes.set(r.id, clone(r)); }
  async deleteRoute(id) { this.routes.delete(id); }
}

class IdbStore {
  constructor() { this.mode = 'browser'; this.db = null; }
  open() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('sin IndexedDB'));
      const rq = indexedDB.open('cuaderno-de-cumbres', 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('routes')) db.createObjectStore('routes', { keyPath: 'id' });
      };
      rq.onsuccess = () => { this.db = rq.result; res(this); };
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('IndexedDB bloqueada'));
    });
  }
  _tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode);
      const os = tx.objectStore(store);
      let out;
      Promise.resolve(fn(os)).then((v) => { out = v; });
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error('transacción abortada'));
    });
  }
  async loadAll() {
    const state = await new Promise((res, rej) => { const rq = this.db.transaction('kv').objectStore('kv').get('state'); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
    const routes = await new Promise((res, rej) => { const rq = this.db.transaction('routes').objectStore('routes').getAll(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); });
    return { state, routes };
  }
  saveState(s) { return this._tx('kv', 'readwrite', (os) => { os.put(clone(s), 'state'); }); }
  saveRoute(r) { return this._tx('routes', 'readwrite', (os) => { os.put(clone(r)); }); }
  deleteRoute(id) { return this._tx('routes', 'readwrite', (os) => { os.delete(id); }); }
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      const code = e && e.code;
      if ((code === 'unavailable' && attempt < 1) || (code === 'resource_exhausted' && attempt < 4)) { await sleep(400 + Math.random() * 600 * (attempt + 1)); continue; }
      throw e;
    }
  }
}
function storeErrorMessage(e) {
  const code = e && e.code;
  if (code === 'quota_exceeded') return 'El almacenamiento del cuaderno está lleno. Borra rutas que no necesites o exporta tus datos.';
  if (code === 'invalid_argument') return 'Esta vista no permite guardar cambios.';
  if (code === 'revoked' || code === 'not_granted') return 'Esta vista ya no tiene acceso a tus datos guardados.';
  return 'No se pudo guardar: ' + (e?.message || e);
}
async function initStore() {
  try { return await new IdbStore().open(); }
  catch (e) { console.warn('IndexedDB no disponible', e); return new MemoryStore(); }
}
