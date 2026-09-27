// Stage 4: compress the exported room for the web and write the bake manifest.
//   node tools/pack.mjs            (after export_web.py)
// build/room_raw.glb -> public/room.glb (meshopt, quantised; full textures, for the tour's renders)
//                    -> public/room-lo.glb (the same with textures of at most 256 px: what the
//                       live room loads first) + public/tex/<name>-<hash>.webp (the full
//                       textures, streamed in once you're inside)
// Both models first go through tools/slim_room.mjs (only what the shader reads, simplified
// only where it can't be seen), then meshopt with 16-bit positions: at 14 bits a chunk's
// grid is 0.4-1.3 mm, enough to merge thin labels into what they lie on (they flickered).
// bake/*.png -> *.webp and a quarter-size *-lo.webp; manifest = light ranges + material kinds.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const kb = (f) => Math.round(statSync(f).size / 1024);
const compress = (raw, out) => {
  const slim = raw.replace('_raw.glb', '_slim.glb');
  execFileSync('node', ['tools/slim_room.mjs', raw, slim], { stdio: 'inherit' });
  execFileSync('npx', ['gltf-transform', 'meshopt', slim, out, '--level', 'medium', '--quantize-position', '16'], { stdio: 'inherit' });
};
compress('build/room_raw.glb', 'public/room.glb');

// The live room starts with small textures and streams sharper ones in afterwards: the full
// ones on computers, copies of at most 512 px on phones and tablets (whose graphics memory
// can't hold every full texture: 667 MB of them, 145 MB at 512 px).
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
  if (Math.max(width, height) > 512) {
    const md = file.replace(/\.\w+$/, '-512.webp');
    await sharp(img).resize(512, 512, { fit: 'inside' }).webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(`public/tex/${md}`);
    textures[name].md = md;
  }
  if (Math.max(width, height) > 256) {
    t.setImage(await sharp(img).resize(256, 256, { fit: 'inside' }).webp({ quality: 80, alphaQuality: 90 }).toBuffer()).setMimeType('image/webp');
  }
}
await io.write('build/room_lo_raw.glb', doc);
compress('build/room_lo_raw.glb', 'public/room-lo.glb');

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
  // and a quarter-size copy the live room starts with (light is smooth: it hardly shows),
  // and a half-size one that phones and tablets keep
  await sharp(`${dir}/${f}`).resize(Math.round(r.res / 4)).webp({ quality: 86, effort: 6 }).toFile(`${dir}/${name}-lo.webp`);
  await sharp(`${dir}/${f}`).resize(Math.round(r.res / 2)).webp({ quality: 86, effort: 6 }).toFile(`${dir}/${name}-md.webp`);
  const entry = { name, group: r.group, file: `${name}.webp`, lo: `${name}-lo.webp`, md: `${name}-md.webp`, size: r.res, range: r.range, kb: kb(`${dir}/${name}.webp`) };
  if (r.albedo) {
    await sharp(`${dir}/${name}_albedo.png`).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo.webp`);
    entry.albedo = `${name}_albedo.webp`;
    await sharp(`${dir}/${name}_albedo.png`).resize(Math.round(r.res / 4)).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo-lo.webp`);
    entry.albedoLo = `${name}_albedo-lo.webp`;
    await sharp(`${dir}/${name}_albedo.png`).resize(Math.round(r.res / 2)).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo-md.webp`);
    entry.albedoMd = `${name}_albedo-md.webp`;
    entry.kb += kb(`${dir}/${name}_albedo.webp`);
  }
  chunks.push(entry);
}
const manifest = { built: new Date().toISOString(), glb_kb: kb('public/room.glb'), lo_kb: kb('public/room-lo.glb'), chunks, textures, materials: materials.materials };
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
const total = manifest.glb_kb + chunks.reduce((s, c) => s + c.kb, 0);
console.log(`room.glb ${manifest.glb_kb} KB + ${chunks.length} light sets = ${(total / 1024).toFixed(1)} MB`);
