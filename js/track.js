'use strict';
/* ======== 3. Procesado de tracks (estadísticas, simplificado, huella) ======== */
const ELE_WINDOW = 20;   // m a cada lado para suavizar la altitud
const ELE_HYST = 2;      // m de histéresis para el desnivel
const MAX_STORED_POINTS = 6000;

function fillGaps(arr) {
  const n = arr.length;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (arr[i] == null) continue;
    if (last === -1) for (let k = 0; k < i; k++) arr[k] = arr[i];
    else if (i - last > 1) for (let k = last + 1; k < i; k++) arr[k] = arr[last] + ((arr[i] - arr[last]) * (k - last)) / (i - last);
    last = i;
  }
  if (last >= 0) for (let k = last + 1; k < n; k++) arr[k] = arr[last];
}

/** Segmentos de puntos → arrays tipados. */
function buildTrack(segments) {
  const lat = [], lon = [], ele = [], t = [], seg = [];
  let eleN = 0, tN = 0, si = 0;
  for (const pts of segments) {
    if (!pts || !pts.length) continue;
    for (const p of pts) {
      const k = lat.length - 1;
      if (k >= 0 && seg[k] === si && p.lat === lat[k] && p.lon === lon[k]) continue;
      lat.push(+p.lat); lon.push(+p.lon);
      ele.push(p.ele == null || !isFinite(p.ele) ? null : +p.ele);
      t.push(p.time == null || !isFinite(p.time) ? null : +p.time);
      seg.push(si);
      if (ele[ele.length - 1] != null) eleN++;
      if (t[t.length - 1] != null) tN++;
    }
    si++;
  }
  const n = lat.length;
  const hasEle = n > 1 && eleN >= Math.max(2, n * 0.5);
  const hasTime = n > 1 && tN >= Math.max(2, n * 0.5);
  if (hasEle) fillGaps(ele);
  if (hasTime) fillGaps(t);
  const T = {
    n,
    lat: Float64Array.from(lat), lon: Float64Array.from(lon),
    ele: hasEle ? Float32Array.from(ele) : null,
    t: hasTime ? Float64Array.from(t, (v) => v / 1000) : null,
    seg: Uint16Array.from(seg),
    multiSeg: si > 1,
  };
  T.cum = cumulative(T);
  return T;
}
function cumulative(T) {
  const { n, lat, lon, seg } = T;
  const cum = new Float64Array(n);
  let d = 0;
  for (let i = 1; i < n; i++) {
    if (seg[i] === seg[i - 1]) d += haversine(lat[i - 1], lon[i - 1], lat[i], lon[i]);
    cum[i] = d;
  }
  return cum;
}
function smoothEle(T, W) {
  const { n, ele, cum, seg } = T;
  const out = new Float32Array(n);
  let a = 0, b = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && seg[b] === seg[i] && cum[b] - cum[i] <= W) { sum += ele[b]; cnt++; b++; }
    while (a < i && (seg[a] !== seg[i] || cum[i] - cum[a] > W)) { sum -= ele[a]; cnt--; a++; }
    out[i] = cnt ? sum / cnt : ele[i];
  }
  return out;
}
function computeStats(T) {
  const { n, t, seg, cum } = T;
  const st = { dist: Math.round(cum[n - 1] || 0), gain: null, loss: null, maxEle: null, minEle: null, duration: null, moving: null, start: null };
  if (T.ele) {
    const sm = smoothEle(T, ELE_WINDOW);
    let gain = 0, loss = 0, mx = -Infinity, mn = Infinity, ref = sm[0];
    for (let i = 0; i < n; i++) {
      if (i > 0 && seg[i] !== seg[i - 1]) ref = sm[i];
      const v = sm[i];
      if (v > mx) mx = v;
      if (v < mn) mn = v;
      const d = v - ref;
      if (d >= ELE_HYST) { gain += d; ref = v; } else if (d <= -ELE_HYST) { loss -= d; ref = v; }
    }
    Object.assign(st, { gain: Math.round(gain), loss: Math.round(loss), maxEle: Math.round(mx), minEle: Math.round(mn) });
  }
  if (t) {
    st.start = t[0];
    st.duration = Math.max(0, Math.round(t[n - 1] - t[0]));
    let mv = 0;
    for (let i = 1; i < n; i++) {
      const dt = t[i] - t[i - 1];
      if (seg[i] !== seg[i - 1] || dt <= 0 || dt > 600) continue;
      if ((cum[i] - cum[i - 1]) / dt >= 0.3) mv += dt;
    }
    st.moving = Math.round(mv);
  }
  return st;
}

/** Douglas-Peucker 3D (altitud incluida) por segmento. Devuelve índices conservados. */
function simplifyIdx(T, tol) {
  const { n, lat, lon, seg } = T;
  const ele = T.ele;
  let mlat = 0;
  for (let i = 0; i < n; i++) mlat += lat[i];
  mlat /= n || 1;
  const kx = M_PER_DEG * Math.cos(toRad(mlat)), ky = M_PER_DEG;
  const keep = new Uint8Array(n);
  const tol2 = tol * tol;
  const X = (i) => lon[i] * kx, Y = (i) => lat[i] * ky, Z = (i) => (ele ? ele[i] : 0);
  function dp(first, last) {
    keep[first] = 1; keep[last] = 1;
    const stack = [first, last];
    while (stack.length) {
      const l = stack.pop(), f = stack.pop();
      const ax = X(f), ay = Y(f), az = Z(f);
      const vx = X(l) - ax, vy = Y(l) - ay, vz = Z(l) - az;
      const L2 = vx * vx + vy * vy + vz * vz;
      let maxD = 0, idx = -1;
      for (let k = f + 1; k < l; k++) {
        const px = X(k) - ax, py = Y(k) - ay, pz = Z(k) - az;
        let tt = L2 > 0 ? (px * vx + py * vy + pz * vz) / L2 : 0;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const dx = px - tt * vx, dy = py - tt * vy, dz = pz - tt * vz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d > maxD) { maxD = d; idx = k; }
      }
      if (idx > 0 && maxD > tol2) { keep[idx] = 1; stack.push(f, idx, idx, l); }
    }
  }
  let s0 = 0;
  for (let i = 1; i <= n; i++) if (i === n || seg[i] !== seg[i - 1]) { if (i - 1 > s0) dp(s0, i - 1); else keep[s0] = 1; s0 = i; }
  const idx = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}
function simplifyForStorage(T) {
  let tol = 2, idx = simplifyIdx(T, tol);
  while (idx.length > MAX_STORED_POINTS && tol < 200) { tol *= 1.6; idx = simplifyIdx(T, tol); }
  return idx;
}

/* Codificación compacta: varints en base64url con deltas */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = (() => { const m = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i; return m; })();
function encVarints(nums) {
  const out = [];
  for (const v of nums) {
    let z = v >= 0 ? v * 2 : -v * 2 - 1;
    while (z >= 32) { out.push(B64[(z % 32) | 32]); z = Math.floor(z / 32); }
    out.push(B64[z]);
  }
  return out.join('');
}
function decVarints(str) {
  const out = [];
  let z = 0, mul = 1;
  for (let i = 0; i < str.length; i++) {
    const c = B64I[str.charCodeAt(i)];
    if (c < 0) throw new Error('track corrupto');
    z += (c & 31) * mul;
    if (c & 32) mul *= 32;
    else { out.push(z % 2 ? -(z + 1) / 2 : z / 2); z = 0; mul = 1; }
  }
  return out;
}
function encodeTrack(T, idx) {
  const hasE = !!T.ele, hasT = !!T.t, hasS = !!T.multiSeg;
  const nums = [];
  let pl = 0, po = 0, pe = 0, ps = 0;
  const t0 = hasT ? Math.round(T.t[idx[0]]) : 0;
  let pt = t0;
  for (const i of idx) {
    const la = Math.round(T.lat[i] * 1e5), lo = Math.round(T.lon[i] * 1e5);
    nums.push(la - pl, lo - po); pl = la; po = lo;
    if (hasE) { const e = Math.round(T.ele[i] * 10); nums.push(e - pe); pe = e; }
    if (hasT) { const tt = Math.round(T.t[i]); nums.push(tt - pt); pt = tt; }
    if (hasS) { nums.push(T.seg[i] - ps); ps = T.seg[i]; }
  }
  return { f: (hasE ? 1 : 0) | (hasT ? 2 : 0) | (hasS ? 4 : 0), n: idx.length, t0, d: encVarints(nums) };
}
function decodeTrack(trk) {
  const nums = decVarints(trk.d);
  const n = trk.n, hasE = trk.f & 1, hasT = trk.f & 2, hasS = trk.f & 4;
  const P = {
    n, lat: new Float64Array(n), lon: new Float64Array(n),
    ele: hasE ? new Float32Array(n) : null, t: hasT ? new Float64Array(n) : null,
    seg: new Uint16Array(n), multiSeg: !!hasS,
  };
  let k = 0, pl = 0, po = 0, pe = 0, pt = trk.t0 || 0, ps = 0;
  for (let i = 0; i < n; i++) {
    pl += nums[k++]; po += nums[k++];
    P.lat[i] = pl / 1e5; P.lon[i] = po / 1e5;
    if (hasE) { pe += nums[k++]; P.ele[i] = pe / 10; }
    if (hasT) { pt += nums[k++]; P.t[i] = pt; }
    if (hasS) { ps += nums[k++]; P.seg[i] = ps; }
  }
  if (k !== nums.length) throw new Error('track corrupto');
  P.cum = cumulative(P);
  return P;
}

/** Huella para detectar rutas repetidas. */
function fingerprint(T, st) {
  const parts = new Array(T.n + 1);
  parts[0] = String(T.n);
  for (let i = 0; i < T.n; i++) parts[i + 1] = Math.round(T.lat[i] * 1e5) + ',' + Math.round(T.lon[i] * 1e5) + (T.t ? ',' + Math.round(T.t[i]) : '');
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  return {
    h: cyrb64(parts.join(';')),
    t: T.t ? Math.round(T.t[0]) : null,
    d: st.dist,
    a: [r5(T.lat[0]), r5(T.lon[0])],
    b: [r5(T.lat[T.n - 1]), r5(T.lon[T.n - 1])],
  };
}
function sameActivity(f1, f2) {
  if (!f1 || !f2) return false;
  if (f1.h && f1.h === f2.h) return true;
  const dd = Math.abs(f1.d - f2.d) <= Math.max(150, 0.03 * Math.max(f1.d, f2.d));
  if (f1.t != null && f2.t != null) return Math.abs(f1.t - f2.t) <= 120 && dd;
  if (f1.t == null && f2.t == null) {
    return dd && haversine(f1.a[0], f1.a[1], f2.a[0], f2.a[1]) < 30 && haversine(f1.b[0], f1.b[1], f2.b[0], f2.b[1]) < 30 && Math.abs(f1.d - f2.d) <= 0.02 * Math.max(f1.d, f2.d) + 20;
  }
  return false;
}
