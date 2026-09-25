// Stage 4: compress the exported room for the web and write the bake manifest.
//   node tools/pack.mjs            (after export_web.py)
// build/room_raw.glb -> public/room.glb (meshopt, quantised; embedded textures stay WebP)
// bake/*.png -> *.webp; manifest = light ranges + material kinds.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const kb = (f) => Math.round(statSync(f).size / 1024);
execFileSync('npx', ['gltf-transform', 'meshopt', 'build/room_raw.glb', 'public/room.glb', '--level', 'medium'], { stdio: 'inherit' });

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
  const entry = { name, group: r.group, file: `${name}.webp`, size: r.res, range: r.range, kb: kb(`${dir}/${name}.webp`) };
  if (r.albedo) {
    await sharp(`${dir}/${name}_albedo.png`).webp({ quality: 84, effort: 6 }).toFile(`${dir}/${name}_albedo.webp`);
    entry.albedo = `${name}_albedo.webp`;
    entry.kb += kb(`${dir}/${name}_albedo.webp`);
  }
  chunks.push(entry);
}
const manifest = { built: new Date().toISOString(), glb_kb: kb('public/room.glb'), chunks, materials: materials.materials };
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
const total = manifest.glb_kb + chunks.reduce((s, c) => s + c.kb, 0);
console.log(`room.glb ${manifest.glb_kb} KB + ${chunks.length} light sets = ${(total / 1024).toFixed(1)} MB`);
