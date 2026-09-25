// Where the visitor is and how they move. Each place is a panorama; moving is a
// short pre-rendered flight (the drone moves of the real-time version, rendered
// in advance), played as a video. Before a flight the view turns to its exact
// first frame, and it lands on the next panorama at its exact last frame, so the
// hand-off is invisible. Looking around is a damped spring toward the pointer.
import { Camera, qaxis, qmul, qslerp, deg, clamp, lerp, smoother } from './m.js';

export const PARENT = { tv: 'couch', games: 'couch', pc: 'desk', memo: 'bed' };
const FOCUS = { tv: 'tv', games: 'tv', pc: 'pc', memo: 'memo' };
const STANDING = new Set(['hall', 'room']);
const VIDEO_ASPECT = 16 / 9;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Tour extends EventTarget {
  constructor(manifest, anchors, loader, video) {
    super();
    this.m = manifest;
    this.anchors = anchors;
    this.loader = loader;
    this.video = video;
    this.camera = new Camera();
    this.place = null;
    this.focus = null;
    this.busy = false;
    this.pano = null;                    // the panorama shown (a view key)
    this.hfov = 70;
    this.look = [0, 0];
    this.lookVel = [0, 0];
    this.pointer = [0, 0];
    this.nudge = [0, 0];                 // the intro's knocks shake the view
    this.anim = null;
    this.drag = null;
    this.aspect = innerWidth / innerHeight;
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.pointer = [(e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1];
      else if (this.drag) {
        const k = 2.2 / Math.min(innerWidth, innerHeight);
        this.pointer = [clamp(this.drag.px - (e.clientX - this.drag.x) * k, -2.6, 2.6), clamp(this.drag.py - (e.clientY - this.drag.y) * k, -1.2, 1.2)];
      }
    });
    addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && e.target.tagName === 'CANVAS') this.drag = { x: e.clientX, y: e.clientY, px: this.pointer[0], py: this.pointer[1] };
    });
    addEventListener('pointerup', () => { this.drag = null; });
  }

  view(key) { return key === 'games' ? 'tv' : key; }
  pose(key) { return this.m.views[this.view(key)].pose; }

  /** The field of view that shows a place well in this window. */
  placeHfov(key) {
    const p = this.pose(key);
    if (!FOCUS[key]) return p.hfov;
    // a screen close-up: fit the screen (90%) whatever the window's shape
    const s = this.anchors.screens[FOCUS[key]];
    const d = Math.hypot(p.eye[0] - s.center[0], p.eye[1] - s.center[1], p.eye[2] - s.center[2]);
    const tx = s.width / 2 / d / 0.9, ty = s.height / 2 / d / 0.9;
    return Math.max(p.hfov, 2 * Math.atan(Math.max(tx, ty * this.aspect)) * 180 / Math.PI);
  }

  /** The horizontal field of view a 16:9 video frame shows when it covers this window. */
  coverHfov(h) {
    if (this.aspect >= VIDEO_ASPECT) return h;
    return 2 * Math.atan(Math.tan(deg(h) / 2) * this.aspect / VIDEO_ASPECT) * 180 / Math.PI;
  }

  snap(key) {
    this.place = key;
    this.focus = FOCUS[key] || null;
    this.pano = this.view(key);
    this.hfov = this.placeHfov(key);
    this.look = [0, 0]; this.lookVel = [0, 0];
    this.apply();
    if (this.focus) this.dispatchEvent(new CustomEvent('focus', { detail: { name: this.focus, place: key } }));
    this.dispatchEvent(new CustomEvent('arrive', { detail: { place: key } }));
  }

  /** The chain of flights from here to there. */
  route(a, b) {
    const has = (x, y) => !!this.m.moves[`${x}>${this.view(y) === 'tv' && y === 'games' ? 'tv' : y}`];
    const key = (x, y) => `${x}>${y === 'games' ? 'tv' : y}`;
    if (a === b) return [];
    if (a === 'games') a = 'tv';
    if (has(a, b)) return [key(a, b)];
    if (PARENT[a]) return [key(a, PARENT[a]), ...this.route(PARENT[a], b)];
    if (PARENT[b] && PARENT[b] !== a) return [...this.route(a, PARENT[b]), key(PARENT[b], b)];
    if (a !== 'room' && b !== 'room') return [...this.route(a, 'room'), ...this.route('room', b)];
    return [];
  }

  async goTo(key) {
    if (this.busy || key === this.place) return;
    const from = this.place;
    const chain = this.route(from, key);
    if (!chain.length) return;
    this.busy = true;
    this.dispatchEvent(new CustomEvent('leave', { detail: { from, to: key } }));
    await this.fly(chain, key);
    this.place = key;
    this.focus = FOCUS[key] || null;
    this.busy = false;
    if (this.focus) this.dispatchEvent(new CustomEvent('focus', { detail: { name: this.focus, place: key } }));
    this.dispatchEvent(new CustomEvent('arrive', { detail: { place: key } }));
  }

  /** Play a chain of flights and land on the last one's panorama. */
  async fly(chain, dest) {
    const moves = chain.map((k) => this.m.moves[k]);
    const first = moves[0], last = moves[moves.length - 1];
    const srcs = chain.map((k) => this.loader.video(k, 0));
    this.loader.pano(this.view(dest), 0);
    let urls = null;
    if (!reduced) urls = await Promise.race([Promise.all(srcs), new Promise((r) => setTimeout(() => r(null), 5000))]);
    // 1. turn to the flight's first frame
    await this.tween({ look: [0, 0], hfov: this.coverHfov(first.first[7]), quat: first.first.slice(3, 7) }, 0.32);
    if (urls) {
      for (let i = 0; i < moves.length; i++) await this.video.play(urls[i], i === 0);
    } else {
      await this.loader.pano(this.view(dest), 0);     // no video in time: a quick dissolve instead
      await this.video.dissolve();
    }
    // 2. land on the panorama at the last frame, then settle into the place's own framing
    this.pano = this.view(dest);
    this.base = last.last.slice(3, 7);
    this.hfov = this.coverHfov(last.last[7]);
    this.look = [0, 0]; this.lookVel = [0, 0];
    this.apply();
    this.dispatchEvent(new Event('change'));
    await this.video.hide();
    this.base = null;
    await this.tween({ hfov: this.placeHfov(dest) }, 0.35);
  }

  /** Animate look / fov / base rotation toward a target. */
  tween(to, secs) {
    return new Promise((resolve) => {
      this.anim = { t: 0, secs, from: { look: [...this.look], hfov: this.hfov, quat: this.baseQuat() }, to, resolve };
      this.dispatchEvent(new Event('change'));       // the loop may be asleep: wake it
    });
  }

  baseQuat() { return this.base || this.pose(this.pano).quat; }

  /** Advance by dt; returns true when the camera moved. */
  update(dt) {
    const a = this.anim;
    if (a) {
      a.t = Math.min(1, a.t + dt / a.secs);
      const u = smoother(a.t);
      if (a.to.look) this.look = [lerp(a.from.look[0], a.to.look[0], u), lerp(a.from.look[1], a.to.look[1], u)];
      if (a.to.hfov != null) this.hfov = lerp(a.from.hfov, a.to.hfov, u);
      if (a.to.quat) this.base = qslerp(a.from.quat, a.to.quat, u);
      this.lookVel = [0, 0];
      if (a.t >= 1) { this.anim = null; a.resolve(); }
    } else if (!this.busy) {
      // free look: a critically damped spring toward the pointer; near a hotspot the
      // target becomes "here plus a little of where we were going", so it glides to rest
      // zoomed into a screen the view holds still, so its buttons don't slide under the pointer
      const range = this.focus ? 0 : STANDING.has(this.place) ? 0.24 : 0.15;
      let t = [-this.pointer[0] * range, -this.pointer[1] * range * 0.55];
      if (this.holdLook) t = [this.look[0] + this.lookVel[0] * 0.18, this.look[1] + this.lookVel[1] * 0.18];
      const w = 7.5;
      for (let i = 0; i < 2; i++) {
        this.lookVel[i] += ((t[i] - this.look[i]) * w * w - 2 * w * this.lookVel[i]) * dt;
        this.look[i] += this.lookVel[i] * dt;
      }
    }
    return this.apply();
  }

  apply() {
    const c = this.camera, p = this.pose(this.pano);
    const yaw = this.look[0] + this.nudge[0], pitch = this.look[1] + this.nudge[1];
    c.pos = p.eye;
    c.quat = qmul(qmul(qaxis([0, 1, 0], yaw), this.baseQuat()), qaxis([1, 0, 0], pitch));
    c.aspect = this.aspect;
    const v = 2 * Math.atan(Math.tan(deg(this.hfov) / 2) / this.aspect) * 180 / Math.PI;
    c.fov = Math.min(v, this.focus || this.busy ? 179 : 105);
    // (rounded: the look spring settles forever in ever smaller steps no one can see)
    const key = [...c.quat.map((q) => q.toFixed(5)), c.fov.toFixed(3), c.aspect.toFixed(4), this.pano].join();
    const moved = key !== this.last;
    this.last = key;
    c.update();
    return moved;
  }

  resize() {
    this.aspect = innerWidth / innerHeight;
    if (this.place && !this.busy) this.hfov = this.placeHfov(this.place);
    this.last = null;
  }
}
