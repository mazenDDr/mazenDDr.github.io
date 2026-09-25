// Stage 4: compress the exported room for the web and write the bake manifest.
//   node tools/pack.mjs            (after export_web.py)
// build/room_raw.glb -> public/room.glb (meshopt, quantised; full textures, for the tour's renders)
//                    -> public/room-lo.glb (the same with textures of at most 256 px: what the
//                       live room loads first) + public/tex/<name>-<hash>.webp (the full
//                       textures, streamed in once you're inside)
// bake/*.png -> *.webp and a quarter-size *-lo.webp; manifest = light ranges + material kinds.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const kb = (f) => Math.round(statSync(f).size / 1024);
execFileSync('npx', ['gltf-transform', 'meshopt', 'build/room_raw.glb', 'public/room.glb', '--level', 'medium'], { stdio: 'inherit' });

// The live room starts with small textures and streams the full ones in afterwards.
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('build/room_raw.glb');
rmSync('public/tex', { recursive: true, force: true });
mkdirSync('public/tex', { recursive: true });
const textures = {};
for (const t of doc.getRoot().listTextures()) {
  const img = Buffer.from(t.getImage());
  const name = t.getName();
  const ext = t.getMimeType() === 'image/webp' ? 'webp' : t.getMimeType() === 'image/png' ? 'png' : 'jpg';
  const file = `${name.replace(/[^\w.-]+/g, '_')}-${createHash('sha1').update(img).digest('hex').slice(0, 8)}.${ext}`;
  writeFileSync(`public/tex/${file}`, img);
  const { width, height } = await sharp(img).metadata();
  textures[name] = { file, size: [width, height] };
  if (Math.max(width, height) > 256) {
    t.setImage(await sharp(img).resize(256, 256, { fit: 'inside' }).webp({ quality: 80, alphaQuality: 90 }).toBuffer()).setMimeType('image/webp');
  }
}
await io.write('build/room_lo_raw.glb', doc);
execFileSync('npx', ['gltf-transform', 'meshopt', 'build/room_lo_raw.glb', 'public/room-lo.glb', '--level', 'medium'], { stdio: 'inherit' });

const dir = 'public/bake';
const report = JSON.parse(readFileSync('tools/bake_report.json', 'utf8'));
const materials = JSON.parse(readFileSync('build/materials.json', 'utf8'));
const chunks = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('_albedo.png')).sort()) {
  const name = f.replace('.png', '');
  const r = report[name];
  if (!r) continue;
  // Light is smooth: high-quality lossy WebP holds it well. Colour atlases get more care.
  await sharp(`${dir}/${f}`).webp({ quality: 86, effort: 6 }).toFile(`${dir}/${name}.webp`);
  // and a quarter-size copy the live room starts with (light is smooth: it hardly shows)
  await sharp(`${dir}/${f}`).resize(Math.round(r.res / 4)).webp({ quality: 86, effort: 6 }).toFile(`${dir}/${name}-lo.webp`);
  const entry = { name, group: r.group, file: `${name}.webp`, lo: `${name}-lo.webp`, size: r.res, range: r.range, kb: kb(`${dir}/${name}.webp`) };
  if (r.albedo) {
    await sharp(`${dir}/${name}_albedo.png`).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo.webp`);
    entry.albedo = `${name}_albedo.webp`;
    await sharp(`${dir}/${name}_albedo.png`).resize(Math.round(r.res / 4)).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo-lo.webp`);
    entry.albedoLo = `${name}_albedo-lo.webp`;
    entry.kb += kb(`${dir}/${name}_albedo.webp`);
  }
  chunks.push(entry);
}
const manifest = { built: new Date().toISOString(), glb_kb: kb('public/room.glb'), lo_kb: kb('public/room-lo.glb'), chunks, textures, materials: materials.materials };
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
const total = manifest.glb_kb + chunks.reduce((s, c) => s + c.kb, 0);
console.log(`room.glb ${manifest.glb_kb} KB + ${chunks.length} light sets = ${(total / 1024).toFixed(1)} MB`);
