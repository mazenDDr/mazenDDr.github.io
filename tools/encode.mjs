// Stage 2 of the pre-rendered tour: turn tools/capture.py's PNGs into what the site loads.
//   node tools/encode.mjs [--only panos|moves]
//
// Panoramas (design/export/tour/pano/<view>/<face>.png, with a 1/64 margin):
//   <view>-strip   all faces at 256 px side by side: one tiny request, shown at once
//   <view>-<face>-1024, -2048   each face; front also -4096 (sharp on big high-DPI screens)
//   AVIF, with WebP for browsers without it. Screens stay transparent (the live pages).
// Flights (design/export/tour/video/<a>-<b>-master.mkv, lossless, from capture.py):
//   H.264 (plays everywhere) and AV1 (half the size, for hardware that decodes it),
//   each at 1080p and 720p.
// Every file is named by its content hash, so browsers and the service worker can keep
// it forever; public/tour/manifest.json says what exists.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const SRC = '../design/export/tour';
const OUT = 'public/tour';
const MOVES = JSON.parse(readFileSync('tools/moves.json', 'utf8'));
const FACES = ['front', 'right', 'left', 'up', 'down'];
const PAD = 1 / 64;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const old = existsSync(`${OUT}/manifest.json`) ? JSON.parse(readFileSync(`${OUT}/manifest.json`, 'utf8')) : {};

mkdirSync(OUT, { recursive: true });
const kb = (f) => Math.round(statSync(`${OUT}/${f}`).size / 1024);

/** Write a buffer under its content hash; returns the file name. */
function put(stem, ext, buf) {
  const name = `${stem}-${createHash('sha1').update(buf).digest('hex').slice(0, 8)}.${ext}`;
  if (!existsSync(`${OUT}/${name}`)) writeFileSync(`${OUT}/${name}`, buf);
  return name;
}

async function both(stem, img) {
  const avif = put(stem, 'avif', await img.clone().avif({ quality: 58, effort: 6, chromaSubsampling: '4:2:0' }).toBuffer());
  const webp = put(stem, 'webp', await img.clone().webp({ quality: 82, effort: 5, alphaQuality: 90 }).toBuffer());
  return { avif, webp, kb: kb(avif) };
}

async function panos() {
  const views = {};
  for (const view of readdirSync(`${SRC}/pano`).sort()) {
    const faces = FACES.filter((f) => existsSync(`${SRC}/pano/${view}/${f}.png`));
    const entry = { pose: MOVES.views[view], faces, files: {} };
    const strip = [];
    for (const face of faces) {
      const src = sharp(`${SRC}/pano/${view}/${face}.png`);
      const { width } = await src.metadata();
      const m = Math.round(width * PAD / (1 + 2 * PAD));               // the margin, in pixels
      const inner = width - 2 * m;
      const crop = await src.extract({ left: m, top: m, width: inner, height: inner }).png().toBuffer();
      const sizes = face === 'front' ? [4096, 2048, 1024] : [2048, 1024];
      entry.files[face] = {};
      for (const n of sizes) {
        entry.files[face][n] = await both(`${view}-${face}-${n}`, sharp(crop).resize(n, n, { kernel: 'lanczos3' }));
      }
      strip.push(await sharp(crop).resize(256, 256, { kernel: 'lanczos3' }).png().toBuffer());
    }
    const canvas = sharp({ create: { width: 256 * strip.length, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
      .composite(strip.map((input, i) => ({ input, left: 256 * i, top: 0 })));
    entry.files.strip = await both(`${view}-strip`, sharp(await canvas.png().toBuffer()));
    views[view] = entry;
    const total = Object.values(entry.files).flatMap((f) => (f.avif ? [f] : Object.values(f))).reduce((s, f) => s + f.kb, 0);
    console.log('pano', view, faces.length, 'faces', total, 'KB of AVIF');
  }
  return views;
}

// Delivery encodes of the lossless masters (tools/capture.py). Quality chosen by VMAF
// on the way-in flight (1080p): H.264 CRF 20 = 96.0 at 2.5 MB; AV1 CRF 36 = 96.1 at
// 1.15 MB. AV1 goes to devices that decode it in hardware, H.264 to everything else.
const LADDER = [
  ['h264', 1080, ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '21']],
  ['h264', 720, ['-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-crf', '23']],
  ['av1', 1080, ['-c:v', 'libsvtav1', '-preset', '5', '-crf', '36', '-svtav1-params', 'tune=0']],
  ['av1', 720, ['-c:v', 'libsvtav1', '-preset', '5', '-crf', '38', '-svtav1-params', 'tune=0']],
];

function moves() {
  const out = {};
  const tmp = `${SRC}/_enc.mp4`;
  for (const [key, m] of Object.entries(MOVES.moves)) {
    const [a, z] = key.split('>');
    const stem = `${SRC}/video/${a}-${z}`;
    if (!existsSync(`${stem}.done`)) continue;
    const n = JSON.parse(readFileSync(`${stem}.done`, 'utf8')).frames;
    const files = { h264: {}, av1: {} }, kbs = { h264: {}, av1: {} };
    for (const [codec, h, args] of LADDER) {
      const name = `${a}-${z}-${codec}-${h}`;
      const cached = old.moves?.[key]?.files?.[codec]?.[h];
      if (cached && existsSync(`${OUT}/${cached}`) && statSync(`${OUT}/${cached}`).mtimeMs > statSync(`${stem}-master.mkv`).mtimeMs) {
        files[codec][h] = cached;                    // this master was already encoded
      } else {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${stem}-master.mkv`,
          '-vf', `scale=-2:${h}:flags=lanczos:out_color_matrix=bt709,format=yuv420p`, ...args,
          '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', '-an', tmp]);
        files[codec][h] = put(name, 'mp4', readFileSync(tmp));
      }
      kbs[codec][h] = kb(files[codec][h]);
    }
    out[key] = { from: a, to: z, frames: n, seconds: +(n / MOVES.fps).toFixed(3), first: m.frames[0], last: m.frames[n - 1], files, kb: kbs };
    console.log('move', key, n, 'frames', JSON.stringify(kbs));
  }
  rmSync(tmp, { force: true });
  return out;
}

const manifest = {
  built: new Date().toISOString(), fps: MOVES.fps, aspect: 16 / 9,
  views: only === 'moves' ? old.views : await panos(),
  moves: only === 'panos' ? old.moves : moves(),
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest));
// drop files the manifest no longer names
const named = new Set(JSON.stringify(manifest).match(/[\w-]+-[0-9a-f]{8}\.(avif|webp|mp4)/g));
for (const f of readdirSync(OUT)) if (/-[0-9a-f]{8}\.(avif|webp|mp4)$/.test(f) && !named.has(f)) rmSync(`${OUT}/${f}`);
const total = readdirSync(OUT).reduce((s, f) => s + statSync(`${OUT}/${f}`).size, 0);
console.log(`public/tour: ${(total / 2 ** 20).toFixed(1)} MB in ${readdirSync(OUT).length} files`);
