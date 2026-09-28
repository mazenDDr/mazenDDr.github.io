// Make the room's geometry lighter without a visible change (run by tools/pack.mjs).
//   node tools/slim_room.mjs IN.glb OUT.glb [--angle 0.0003] [--no-simplify]
// - drops vertex data the room's shader never reads: COLOR_*, NORMAL, TANGENT, and the
//   texture UVs (uv0) of surfaces that have no texture (constant, recipe and special
//   kinds read only the light-map UVs), then welds the vertices that were only apart
//   because of them
// - simplifies each surface only as far as can't be seen from the closest the camera
//   ever gets to it (every place and every frame of every flight, from tools/moves.json):
//   the allowed error is `angle` radians at that distance (0.0003 is half a pixel on a
//   Retina laptop), in metres, never under 0.2 mm. The light-map UVs (uv1) and texture
//   UVs (uv0) count in the error, and every vertex a surface shares with another surface
//   (where two materials meet) is locked, so neighbours never crack apart.
// - moves details that lie on another surface (a label on a box, a band on a book, a
//   window on a facade: tools/zfight_scan.mjs) just in front of it, 0.5 mm or three
//   depth-buffer steps at the closest the camera gets, so the depth test always picks
//   the detail instead of flickering between the two.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { areas, onTop, overlaps, triangles } from './zfight_scan.mjs';

const [inp, out] = process.argv.slice(2);
const arg = (k, d) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const ANGLE = arg('--angle', 0.0003), MIN_ERROR = 0.0002, MAX_ERROR = 0.02;
const SIMPLIFY = !process.argv.includes('--no-simplify'), LOCK_ALL = process.argv.includes('--lock-borders');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inp);
const root = doc.getRoot();

// every camera position a visitor can have (three.js metres)
const moves = JSON.parse((await import('node:fs')).readFileSync('tools/moves.json', 'utf8'));
const eyes = [...Object.values(moves.views).map((v) => v.eye), ...Object.values(moves.moves).flatMap((m) => m.frames.map((f) => f.slice(0, 3)))];
/** Closest a camera gets to a box. */
const nearest = (min, max) => Math.sqrt(Math.min(...eyes.map((e) => e.reduce((s, v, i) => s + Math.max(min[i] - v, 0, v - max[i]) ** 2, 0))));
// light-map resolution per chunk (a UV step of one texel should cost about as much as the position error)
let bake = {};
try { bake = Object.fromEntries(JSON.parse((await import('node:fs')).readFileSync('public/bake/manifest.json', 'utf8')).chunks.map((c) => [c.name, c.size])); } catch { /* default below */ }

// which surfaces read a texture with uv0 (see KIND in engine/src/room.js)
const materials = JSON.parse((await import('node:fs')).readFileSync('build/materials.json', 'utf8')).materials;
const usesUv0 = (m) => { const e = materials[m?.getName()] || { kind: 'image' }; return e.kind === 'image' || e.kind === 'cutout' || !!e.emissiveMap; };
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  for (const s of prim.listSemantics()) if (/^(COLOR_|NORMAL|TANGENT)/.test(s)) prim.setAttribute(s, null);
  if (!usesUv0(prim.getMaterial())) prim.setAttribute('TEXCOORD_0', null);
  if (materials[prim.getMaterial()?.getName()]?.kind === 'glass') prim.setAttribute('TEXCOORD_1', null);
}
await doc.transform(weld());

let before = 0, after = 0;
const chunkOf = new Map(), offset = new Map();      // mesh -> chunk name, and where its node sits (only the door moves)
for (const s of root.listScenes()) for (const n of s.listChildren()) n.traverse((c) => { if (c.getMesh()) { chunkOf.set(c.getMesh(), n.getName()); offset.set(c.getMesh(), c.getWorldTranslation()); } });
const key = (e) => e.map((v) => Math.round(v * 1e5)).join(',');      // 0.01 mm
for (const mesh of root.listMeshes()) {
  const res = bake[chunkOf.get(mesh)] || 2048, at = offset.get(mesh) || [0, 0, 0];
  // positions used by more than one surface of this chunk
  const owners = new Map();
  mesh.listPrimitives().forEach((prim, k) => { const pos = prim.getAttribute('POSITION'); for (let i = 0, e = []; i < pos.getCount(); i++) { const h = key(pos.getElement(i, e)); const o = owners.get(h); owners.set(h, o === undefined || o === k ? k : -1); } });
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
    const n = pos.getCount();
    before += idx ? idx.getCount() / 3 : n / 3;
    if (!SIMPLIFY || !idx || idx.getCount() < 3 * 64) { after += idx ? idx.getCount() / 3 : n / 3; continue; }
    const P = new Float32Array(n * 3);
    for (let i = 0, e = []; i < n; i++) { pos.getElement(i, e); P.set(e, i * 3); }
    const uv0 = prim.getAttribute('TEXCOORD_0'), uv1 = prim.getAttribute('TEXCOORD_1');
    const A = new Float32Array(n * 4);
    for (let i = 0, e = []; i < n; i++) {
      if (uv0) { uv0.getElement(i, e); A[i * 4] = e[0]; A[i * 4 + 1] = e[1]; }
      if (uv1) { uv1.getElement(i, e); A[i * 4 + 2] = e[0]; A[i * 4 + 3] = e[1]; }
    }
    const ERROR = Math.min(MAX_ERROR, Math.max(MIN_ERROR, ANGLE * nearest(pos.getMin([]).map((v, i) => v + at[i]), pos.getMax([]).map((v, i) => v + at[i]))));
    // weights: half a light-map texel, or 1/2048 of a texture, costs as much as ERROR
    const w1 = ERROR / (0.5 / res), w0 = uv0 && prim.getMaterial()?.getBaseColorTexture() ? ERROR / (0.5 / 2048) : 0;
    const I = new Uint32Array(idx.getArray());
    const lock = new Uint8Array(n);
    for (let i = 0, e = []; i < n; i++) if (owners.get(key(pos.getElement(i, e))) === -1) lock[i] = 1;
    const [J] = MeshoptSimplifier.simplifyWithAttributes(I, P, 3, A, 4, [w0, w0, w1, w1], LOCK_ALL ? null : lock, 0, ERROR, LOCK_ALL ? ['LockBorder', 'ErrorAbsolute'] : ['ErrorAbsolute']);
    if (J.length >= I.length * 0.97) { after += I.length / 3; continue; }
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(n > 65535 ? J : new Uint16Array(J)).setBuffer(idx.getBuffer()));
    compactPrimitive(prim);
    after += J.length / 3;
  }
}
// Details lying on another surface, moved just in front of it (after simplifying, which
// could undo it). The depth buffer (24 bits, near plane 3 cm) resolves d² / 2^24 / 0.03 m
// at a distance d: three of those steps, and never under 0.5 mm (16-bit positions move
// a vertex by up to a third of that in a room-sized chunk).
// A detail on a detail (a trim on a panel on a plate) moves again on the next pass.
let lifted = 0, left = 0;
for (let pass = 0; pass < 6; pass++) for (const s of root.listScenes()) for (const node of s.listChildren()) {
  const tris = triangles(node), area = areas(tris), move = new Map();
  const pairs = overlaps(tris);
  if (pass === 5) { left += pairs.length; continue; }
  for (const [tr, o] of pairs) {
    const top = onTop(area, tr, o);
    const lo = [0, 1, 2].map((k) => Math.min(top.a[k], top.b[k], top.c[k])), hi = [0, 1, 2].map((k) => Math.max(top.a[k], top.b[k], top.c[k]));
    const d = Math.max(0.0005, 3 * nearest(lo, hi) ** 2 / 2 ** 24 / 0.03);
    const m = move.get(top.prim) || move.set(top.prim, new Map()).get(top.prim);
    for (const v of top.vi) if (!m.has(v) || m.get(v).d < d) m.set(v, { d, n: top.n });
  }
  for (const [prim, m] of move) {
    const pos = prim.getAttribute('POSITION');
    for (const [v, { d, n }] of m) pos.setElement(v, pos.getElement(v, []).map((x, k) => x + n[k] * d));
    lifted += m.size;
  }
}

// keep what looks unused to glTF: the shader reads uv1 (light maps) and solid-colour textures
await doc.transform(prune({ keepAttributes: true, keepSolidTextures: true }));
await io.write(out, doc);
console.log(JSON.stringify({ triangles_before: Math.round(before), triangles_after: Math.round(after), kept: +(after / before).toFixed(3), angle: SIMPLIFY ? ANGLE : 0, vertices_lifted: lifted, fights_left: left }));
