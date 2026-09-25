// The flights: pre-rendered videos over the view. Two <video> elements take
// turns, so a chain (room -> couch -> TV) cuts from one to the next on a frame.
// A video is shown only once its first frame is on screen, which is the view the
// panorama was just turned to, so nothing jumps. Video is decoded by the
// hardware on every phone and laptop: this is the cheapest way to show motion.
export class Flight {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'flight';
    this.vids = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('muted', '');
      v.disablePictureInPicture = true;
      v.preload = 'auto';
      this.el.append(v);
      return v;
    });
    this.cur = null;
    document.body.append(this.el);
  }

  /** Play one flight to its end. */
  async play(url) {
    const v = this.vids[this.cur === this.vids[0] ? 1 : 0];
    v.src = url;
    v.currentTime = 0;
    const shown = new Promise((res) => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res());
      else v.addEventListener('playing', () => setTimeout(res, 34), { once: true });
    });
    const ended = new Promise((res) => v.addEventListener('ended', res, { once: true }));
    try { await v.play(); } catch { /* shown below anyway */ }
    await Promise.race([shown, new Promise((r) => setTimeout(r, 1500))]);
    v.classList.add('on');
    this.el.classList.add('on');
    if (this.cur && this.cur !== v) this.cur.classList.remove('on');
    this.cur = v;
    await Promise.race([ended, new Promise((r) => setTimeout(r, (v.duration || 6) * 1000 + 1500))]);
  }

  /** Fade the last frame out over the panorama underneath. */
  hide() {
    return new Promise((res) => {
      if (!this.el.classList.contains('on')) return res();
      this.el.classList.remove('on');
      setTimeout(() => { this.vids.forEach((v) => v.classList.remove('on')); this.cur = null; res(); }, 180);
    });
  }

  /** Without a video (not loaded in time, or reduced motion): a short dip. */
  dissolve() {
    this.el.classList.add('on', 'dip');
    return new Promise((res) => setTimeout(() => { this.el.classList.remove('dip'); res(); }, 260));
  }
}
