// Stage 4: compress the exported room for the web and write the bake manifest.
//   node tools/pack.mjs            (after export_web.py)
// room_raw.glb -> public/room.glb (meshopt + quantised), bake/*.png -> *.webp.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const kb = (f) => Math.round(statSync(f).size / 1024);
execFileSync('npx', ['gltf-transform', 'meshopt', 'build/room_raw.glb', 'public/room.glb', '--level', 'medium'], { stdio: 'inherit' });

const dir = 'public/bake';
const chunks = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
  const name = f.replace('.png', '');
  await sharp(`${dir}/${f}`).webp({ quality: 88, effort: 5 }).toFile(`${dir}/${name}.webp`);
  const meta = await sharp(`${dir}/${f}`).metadata();
  chunks.push({ name, file: `${name}.webp`, size: meta.width, kb: kb(`${dir}/${name}.webp`) });
}
const manifest = { built: new Date().toISOString(), glb_kb: kb('public/room.glb'), chunks };
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1));
const total = manifest.glb_kb + chunks.reduce((s, c) => s + c.kb, 0);
console.log(`room.glb ${manifest.glb_kb} KB + ${chunks.length} atlases = ${(total / 1024).toFixed(1)} MB`);
