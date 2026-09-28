// Find surfaces that lie on top of each other (the flicker called z-fighting): triangles of
// different materials in the same chunk, facing the same way, less than `--gap` mm apart and
// overlapping. Reports each pair of materials with the area involved.
//   node tools/zfight_scan.mjs build/room_raw.glb [--gap 0.5]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const GAP = (process.argv.includes('--gap') ? Number(process.argv[process.argv.indexOf('--gap') + 1]) : 0.5) / 1000;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Every triangle of a chunk: corners, normal, centroid, area, and which primitive it's in. */
export function triangles(node) {
  const tris = [];
  node.traverse((c) => {
    const mesh = c.getMesh();
    if (!mesh) return;
    const w = c.getWorldMatrix();                  // (quantized files keep a scale here)
    mesh.listPrimitives().forEach((prim, pi) => {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
      if (!idx) return;
      const p = (i) => { const [x, y, z] = pos.getElement(i, []); return [0, 1, 2].map((k) => w[k] * x + w[4 + k] * y + w[8 + k] * z + w[12 + k]); };
      for (let t = 0; t < idx.getCount(); t += 3) {
        const vi = [idx.getScalar(t), idx.getScalar(t + 1), idx.getScalar(t + 2)];
        const a = p(vi[0]), b = p(vi[1]), c3 = p(vi[2]);
        const n = cross(sub(b, a), sub(c3, a)), len = Math.hypot(...n);
        if (len < 1e-12) continue;
        tris.push({ prim, pi, t, vi, a, b, c: c3, n: n.map((v) => v / len), area: len / 2,
          m: [(a[0] + b[0] + c3[0]) / 3, (a[1] + b[1] + c3[1]) / 3, (a[2] + b[2] + c3[2]) / 3] });
      }
    });
  });
  return tris;
}

/** Is point q (on the triangle's plane, near enough) inside triangle tr? */
function inside(q, tr) {
  const e = [sub(tr.b, tr.a), sub(tr.c, tr.b), sub(tr.a, tr.c)], v = [tr.a, tr.b, tr.c];
  return e.every((ed, i) => dot(cross(ed, sub(q, v[i])), tr.n) >= -1e-9);
}

/** Pairs [under, over] of triangles from different primitives lying on each other. */
export function overlaps(tris, gap = GAP) {
  const cell = 0.02, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const tr of tris) {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(tr.a[k], tr.b[k], tr.c[k]) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(tr.a[k], tr.b[k], tr.c[k]) / cell));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4000) continue;   // walls: none of this
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = key(x, y, z);
      (grid.get(k) || grid.set(k, []).get(k)).push(tr);
    }
  }
  const found = [];
  for (const tr of tris) {
    const c = tr.m.map((v) => Math.floor(v / cell));
    for (const o of grid.get(key(...c)) || []) {
      if (o.prim === tr.prim || dot(o.n, tr.n) < 0.998) continue;
      if (Math.abs(dot(sub(tr.m, o.a), o.n)) > gap) continue;          // tr's centre on o's plane
      if (!inside(tr.m, o)) continue;                                  // tr's centre is covered by o
      // how far each corner is in front of o: all within 0.15 mm, or on both sides (the two
      // cross), and the depth test can't tell them apart
      const d = [tr.a, tr.b, tr.c].map((q) => dot(sub(q, o.a), o.n));
      if (Math.max(...d.map(Math.abs)) < 0.00015 || (Math.min(...d) < 0 && Math.max(...d) > 0)) found.push([tr, o, d]);
    }
  }
  return found;
}

/** Total area of each primitive (by material) in a chunk: in a fighting pair, the smaller
 *  one is the detail lying on the other (a label, a band, a jacket, a window on a facade). */
export function areas(tris) {
  const a = new Map();
  for (const tr of tris) a.set(tr.prim, (a.get(tr.prim) || 0) + tr.area);
  return a;
}

/** Of two fighting triangles, the one on top: the smaller surface (ties: by material name). */
export function onTop(area, x, y) {
  const ax = area.get(x.prim), ay = area.get(y.prim);
  if (ax !== ay) return ax < ay ? x : y;
  return (x.prim.getMaterial()?.getName() || '') < (y.prim.getMaterial()?.getName() || '') ? x : y;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(process.argv[2]);
  const by = new Map();
  for (const s of doc.getRoot().listScenes()) for (const node of s.listChildren()) {
    const tris = triangles(node), area = areas(tris);
    for (const [tr, o] of overlaps(tris)) {
      const a = onTop(area, tr, o).prim, b = a === tr.prim ? o.prim : tr.prim;
      const k = `${node.getName()}  on top: ${a.getMaterial()?.getName()}  (${(area.get(a) * 1e4).toFixed(0)} cm²)   base: ${b.getMaterial()?.getName()} (${(area.get(b) * 1e4).toFixed(0)} cm²)`;
      const e = by.get(k) || { n: 0, area: 0 };
      e.n++; e.area += tr.area;
      by.set(k, e);
    }
  }
  for (const [k, e] of [...by].sort((a, b) => b[1].area - a[1].area)) console.log(`${(e.area * 1e4).toFixed(1).padStart(8)} cm²  ${String(e.n).padStart(5)} tris  ${k}`);
}
