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

  /** Play one flight to its end. `onShown` runs once its first frame covers the view.
   *  Resolves false if the video can't play (e.g. iOS Low Power Mode blocks it). */
  async play(url, onShown) {
    const v = this.vids[this.cur === this.vids[0] ? 1 : 0];
    v.src = url;
    v.currentTime = 0;
    const shown = new Promise((res) => {
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => res(true));
      else v.addEventListener('playing', () => setTimeout(() => res(true), 34), { once: true });
    });
    const ended = new Promise((res) => v.addEventListener('ended', res, { once: true }));
    try { await v.play(); } catch { return false; }
    if (!(await Promise.race([shown, new Promise((r) => setTimeout(() => r(false), 1500))]))) { v.pause(); return false; }
    v.classList.add('on');
    this.el.classList.add('on');
    if (this.cur && this.cur !== v) this.cur.classList.remove('on');
    this.cur = v;
    onShown?.();
    await Promise.race([ended, new Promise((r) => setTimeout(r, (v.duration || 6) * 1000 + 1500))]);
    return true;
  }

  /** No video (not loaded in time, blocked, or reduced motion): hold the current view
   *  as a still over the canvas, so the next place can dissolve in under it. */
  snapshot(canvas) {
    this.shot ||= Object.assign(document.createElement('canvas'), { className: 'shot' });
    this.shot.width = canvas.width;
    this.shot.height = canvas.height;
    this.shot.getContext('2d').drawImage(canvas, 0, 0);
    this.el.append(this.shot);
    this.shot.classList.add('on');
    this.el.classList.add('on', 'still');
  }

  /** Fade the last frame (or the still) out over the panorama underneath. */
  hide(ms = 180) {
    return new Promise((res) => {
      if (!this.el.classList.contains('on')) return res();
      this.el.style.transitionDuration = `${ms}ms`;
      this.el.classList.remove('on');
      setTimeout(() => {
        this.vids.forEach((v) => v.classList.remove('on'));
        this.shot?.classList.remove('on');
        this.el.classList.remove('still');
        this.el.style.transitionDuration = '';
        this.cur = null;
        res();
      }, ms);
    });
  }
}
