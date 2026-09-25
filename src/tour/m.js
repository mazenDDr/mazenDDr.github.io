// The little 3D math the tour needs: a camera (position, rotation, field of view),
// projecting points to the screen, rays from the screen, and boxes. Arrays, not
// classes: [x, y, z], quaternions [x, y, z, w], column-major 4x4 matrices.
// (three.js does all this and much more, at 60 KB compressed; this is ~2 KB.)

export const deg = (d) => (d * Math.PI) / 180;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/** Blender centimetres (x, y, z-up) -> three.js metres (x, y-up, z). */
export const B = (x, y, z = 0) => [x / 100, z / 100, -y / 100];

export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export const qaxis = (axis, a) => { const s = Math.sin(a / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(a / 2)]; };

export function qslerp(a, b, t) {
  let [x, y, z, w] = b, d = a[0] * x + a[1] * y + a[2] * z + a[3] * w;
  if (d < 0) { x = -x; y = -y; z = -z; w = -w; d = -d; }
  if (d > 0.9995) {
    const q = [lerp(a[0], x, t), lerp(a[1], y, t), lerp(a[2], z, t), lerp(a[3], w, t)];
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const th = Math.acos(d), s = Math.sin(th), ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return [a[0] * ka + x * kb, a[1] * ka + y * kb, a[2] * ka + z * kb, a[3] * ka + w * kb];
}
export const qangle = (a, b) => 2 * Math.acos(clamp(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]), 0, 1));

/** Rotation matrix (column-major 3x3 as 9 numbers) of a quaternion. */
export function qmat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
}
export const rot = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

export function mmul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export class Camera {
  constructor() {
    this.pos = [0, 0, 0];
    this.quat = [0, 0, 0, 1];
    this.fov = 60;              // vertical, degrees
    this.aspect = 1;
    this.near = 0.02;
    this.far = 100;
    this.update();
  }

  /** Recompute the matrices after changing pos, quat, fov or aspect. */
  update() {
    const R = qmat(this.quat), p = this.pos;
    // world matrix: rotation then translation; view = its inverse
    this.world = [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, p[0], p[1], p[2], 1];
    const t = [-(R[0] * p[0] + R[1] * p[1] + R[2] * p[2]), -(R[3] * p[0] + R[4] * p[1] + R[5] * p[2]), -(R[6] * p[0] + R[7] * p[1] + R[8] * p[2])];
    this.view = [R[0], R[3], R[6], 0, R[1], R[4], R[7], 0, R[2], R[5], R[8], 0, t[0], t[1], t[2], 1];
    const f = 1 / Math.tan(deg(this.fov) / 2), n = this.near, fa = this.far;
    this.proj = [f / this.aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, (2 * fa * n) / (n - fa), 0];
    this.viewProj = mmul(this.proj, this.view);
    // the same, without the translation: for the panorama, which is infinitely far away
    const v = this.view.slice(); v[12] = v[13] = v[14] = 0;
    this.skyProj = mmul(this.proj, v);
    return this;
  }

  /** World point -> normalised device coordinates [x, y, z] (z > 1 means behind). */
  project(p) {
    const m = this.viewProj, x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
      w <= 0 ? 2 : (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  }

  /** Ray through normalised device coordinates. */
  ray(nx, ny) {
    const ty = Math.tan(deg(this.fov) / 2), d = rot(qmat(this.quat), [nx * ty * this.aspect, ny * ty, -1]);
    const l = Math.hypot(...d);
    return { o: this.pos.slice(), d: d.map((v) => v / l) };
  }
}

/** Distance along a ray to an axis-aligned box [[lo], [hi]], or Infinity. */
export function hitBox({ o, d }, [lo, hi]) {
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let a = (lo[i] - o[i]) * inv, b = (hi[i] - o[i]) * inv;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** A box from two Blender-cm corners. */
export function boxB(a, b) {
  const p = B(...a), q = B(...b);
  return [[0, 1, 2].map((i) => Math.min(p[i], q[i])), [0, 1, 2].map((i) => Math.max(p[i], q[i]))];
}
