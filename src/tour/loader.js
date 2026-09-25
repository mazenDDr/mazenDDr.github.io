// What to download, in what order. Everything is in public/tour/ named by content
// hash (cached forever). A priority queue (lower number first, a few at a time):
// what you are looking at now, then the flights you can take next and where they
// land, then sharper pictures. The size of each picture and video depends on the
// screen and the connection (Save-Data and 2G/3G get the light versions, and
// flights are fetched only when you point at an arrow).
const DIR = 'public/tour/';
const AVIF = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';

export const avifSupported = () => new Promise((res) => {
  const i = new Image();
  i.onload = () => res(i.width > 0);
  i.onerror = () => res(false);
  i.src = AVIF;
});

/** AV1 is half the size of H.264 for the same picture, but only where the hardware
 *  decodes it (software AV1 would cost a weak phone its battery): ask the browser. */
export async function pickCodec() {
  const type = 'video/mp4; codecs="av01.0.09M.08"';
  if (!document.createElement('video').canPlayType(type)) return 'h264';
  try {
    const r = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType: type, width: 1920, height: 1080, bitrate: 2500000, framerate: 60 } });
    return r.supported && r.powerEfficient ? 'av1' : 'h264';
  } catch { return 'h264'; }
}

export class Loader {
  constructor(manifest, viewer, { avif, codec, onReady }) {
    this.m = manifest;
    this.viewer = viewer;
    this.ext = avif ? 'avif' : 'webp';
    this.codec = codec;
    this.onReady = onReady;           // a picture is ready to go on the GPU
    const c = navigator.connection || {};
    this.light = !!c.saveData || /(^|-)(2g|3g)$/.test(c.effectiveType || '');
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.res = !this.light && Math.max(innerWidth, innerHeight) * this.dpr >= 1400 ? '1080' : '720';
    this.queue = [];
    this.running = 0;
    this.max = 4;
    this.blobs = new Map();
    this.done = new Set();
    this.uploads = [];                // decoded pictures waiting for the GPU (one per frame)
    this.panos = {};
  }

  /** A file, fetched once; resolves to a Blob. Lower prio goes first. */
  get(file, prio) {
    let e = this.blobs.get(file);
    if (e) { if (prio < e.prio) { e.prio = prio; this.queue.sort((a, b) => a.prio - b.prio); } return e.promise; }
    e = { file, prio };
    e.promise = new Promise((resolve, reject) => { e.resolve = resolve; e.reject = reject; });
    this.blobs.set(file, e);
    this.queue.push(e);
    this.queue.sort((a, b) => a.prio - b.prio);
    this.pump();
    return e.promise;
  }

  pump() {
    while (this.running < this.max && this.queue.length) {
      const e = this.queue.shift();
      this.running++;
      // Phones drop requests: try a few times before giving up on a file.
      const attempt = (n) => fetch(DIR + e.file)
        .then((r) => { if (!r.ok) throw new Error(`${r.status} ${e.file}`); return r.blob(); })
        .catch((err) => (n < 3 ? new Promise((res) => setTimeout(res, 400 * 2 ** n)).then(() => attempt(n + 1)) : Promise.reject(err)));
      attempt(0)
        .then((b) => { this.done.add(e.file); e.resolve(b); }, (err) => { this.blobs.delete(e.file); e.reject(err); })
        .finally(() => { this.running--; this.pump(); });
    }
  }

  async decode(blob) {
    try { return await createImageBitmap(blob, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' }); } catch { /* older Safari */ }
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode();
    return img;
  }

  /** How sharp a place's faces need to be on this screen. */
  sizes(key) {
    const hfov = this.m.views[key].pose.hfov;
    const need = Math.max(innerWidth, innerHeight * 1.2) * this.dpr / Math.tan((hfov * Math.PI) / 360);
    const side = need > 1150 && !this.light ? 2048 : 1024;
    const front = need > 2500 && !this.light && this.viewer.maxTex >= 4096 ? 4096 : side;
    return { front, side };
  }

  /** A place's pictures: strip, then 1024 faces, then (if `sharp`) as sharp as the
   *  screen can show. Resolves when it looks right (the 1024 faces). */
  pano(key, prio = 3, sharp = true) {
    const v = this.m.views[key];
    this.viewer.add(key, v.pose.quat, v.faces);
    const had = this.panos[key];
    if (had && had.prio <= prio && (had.sharp || !sharp)) return had.promise;
    const put = (face, size) => (blob) => this.decode(blob).then((img) => new Promise((res) => {
      this.uploads.push({ key, run: () => { this.viewer.setFace(key, face, img, size); res(); } });
      this.onReady();
    }));
    const file = (face, size) => v.files[face][size][this.ext];
    const strip = this.get(v.files.strip[this.ext], prio).then(put('strip', 0));
    const base = Promise.all(v.faces.map((f) => this.get(file(f, 1024), prio + 1).then(put(f, 1024))));
    if (sharp) {
      const { front, side } = this.sizes(key);
      base.then(() => Promise.all(v.faces.map((f) => {
        const n = f === 'front' ? front : side;
        return n > 1024 ? this.get(file(f, n), prio + 4).then(put(f, n)) : null;
      }))).catch(() => {});
    }
    strip.catch(() => {});
    this.panos[key] = { prio: Math.min(prio, had?.prio ?? prio), promise: base, sharp: sharp || had?.sharp };
    return base;
  }

  /** A flight as an object URL (the whole file, so it can never stall mid-flight). */
  video(key, prio = 5) {
    const mv = this.m.moves[key];
    return this.get(mv.files[this.codec][this.res], prio).then((b) => (mv.url ||= URL.createObjectURL(b)));
  }

  /** The flight's file and size (KB) as this device will get it. */
  videoFile(key) { const mv = this.m.moves[key]; return [mv.files[this.codec][this.res], mv.kb[this.codec][this.res]]; }

  /** Bytes (from the manifest) of files done, for the knocking to react to. */
  progress(files) {
    let got = 0, all = 0;
    for (const [f, kb] of files) { all += kb; if (this.done.has(f)) got += kb; }
    return all ? got / all : 1;
  }

  /** After arriving somewhere: the flights you can take from here, and where they land. */
  prefetch(place) {
    const from = place === 'games' ? 'tv' : place;
    for (const [key, mv] of Object.entries(this.m.moves)) {
      if (mv.from !== from) continue;
      this.pano(mv.to, 6, false);
      if (!this.light) this.video(key, 8).catch(() => {});
    }
  }

  /** Keep the GPU to a few places at a time. */
  trim(keep) {
    for (const key of Object.keys(this.viewer.panos)) {
      if (keep.includes(key)) continue;
      this.viewer.drop(key);
      delete this.panos[key];
    }
  }
}
