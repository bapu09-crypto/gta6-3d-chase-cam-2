// util.js — small math + seeded-random helpers shared by every module.
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function dist2(ax, az, bx, bz) { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; }
export function dist(ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); }
// Shortest signed angle from a to b, in (-PI, PI].
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
// Deterministic mulberry32 RNG: the same seed always builds the same city.
export function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
// Segment (ax,az)-(bx,bz) vs axis-aligned box {x0,z0,x1,z1}: true when they touch.
export function segHitsBox(ax, az, bx, bz, box) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - box.x0, box.x1 - ax, az - box.z0, box.z1 - az];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
  }
  return true;
}
// Closest point on segment ab to point p, returned as {x, z, t}.
export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  t = clamp(t, 0, 1);
  return { x: ax + dx * t, z: az + dz * t, t };
}
